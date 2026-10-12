// Isolated filesystem TEST worker. No web route, Supabase credentials or real collection switch.
import {mkdir,writeFile,readFile,rename,rm,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {inspectDocumentCandidate} from '../../src/partner-real-readiness.mjs';
import {sha256} from './clamav-scanner.mjs';
const qa=s=>typeof s==='string'&&/^QA-[A-Za-z0-9_-]{1,80}$/.test(s);
const fail=()=>{throw Error('DOCUMENT_ACCESS_DENIED')};
export class PrivateDocumentWorker {
  #records=new Map();#links=new Map();#events=[];#initialized=false;#root;#ownsRoot=false;
  constructor({root,scanner,authorize=async()=>false,now=()=>Date.now(),ttlMs=120000}={}){
    if(!path.isAbsolute(root||'')||!scanner||!Number.isInteger(ttlMs)||ttlMs<1||ttlMs>120000)throw Error('WORKER_CONFIGURATION_REQUIRED');
    this.#root=root;Object.assign(this,{scanner,authorize,now,ttlMs});
  }
  async init(){
    // Dedicated directory must not already exist: no adoption of public, shared or symlink roots.
    await mkdir(this.#root,{mode:0o700});this.#ownsRoot=true;
    for(const dir of ['staging','clean'])await mkdir(path.join(this.#root,dir),{mode:0o700});
    this.#initialized=true;return this;
  }
  #audit(id,event){this.#events.push({id,event,at:this.now()});if(this.#events.length>200)this.#events.shift()}
  async #allowed(context,owner){if(!this.#initialized||!qa(owner)||!await this.authorize(context,owner))fail()}
  async put({context,owner,bytes,mime,synthetic=false}={}){
    await this.#allowed(context,owner);
    if(synthetic!==true||!inspectDocumentCandidate({size:bytes?.length,mime,bytes}).valid)throw Error('DOCUMENT_PREFLIGHT_DENIED');
    await this.expire();if(this.#records.size>=20)throw Error('DOCUMENT_CAPACITY');
    const id=randomUUID(),file=path.join(this.#root,'staging',id),copy=Buffer.from(bytes),hash=sha256(copy);
    const r={id,owner,mime,hash,file,state:'quarantined',expiresAt:this.now()+this.ttlMs};
    this.#records.set(id,r);
    try{await writeFile(file,copy,{mode:0o600,flag:'wx'})}catch{this.#records.delete(id);throw Error('DOCUMENT_STAGING_DENIED')}finally{copy.fill(0)}
    this.#audit(id,'quarantined');
    let proof;try{proof=await this.scanner.scan(file)}catch{proof={status:'unavailable'}}
    try{
      if(r.state!=='quarantined'||r.expiresAt<=this.now()||!await this.authorize(context,owner)||proof?.status!=='clean'||proof.engine!=='clamav'||!/^ClamAV \d+\.\d+\.\d+$/.test(proof.engineVersion||'')||!/^\d+$/.test(proof.definitionsVersion||'')||proof.sha256!==hash||!Number.isFinite(proof.scannedAt)||proof.scannedAt>this.now()+1000||this.now()-proof.scannedAt>30000||!Number.isFinite(proof.definitionsAt)||this.now()-proof.definitionsAt>48*3600000||proof.definitionsAt>this.now()+300000)throw Error('DOCUMENT_SCAN_DENIED');
      const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||sha256(await readFile(file))!==hash)throw Error('DOCUMENT_INTEGRITY_DENIED');
      const target=path.join(this.#root,'clean',id);
      await rename(file,target);r.file=target;
      // Re-check after atomic rename and before publishing a capability.
      if(r.state!=='quarantined'||r.expiresAt<=this.now()||!await this.authorize(context,owner)||sha256(await readFile(target))!==hash)throw Error('DOCUMENT_PROMOTION_DENIED');
      r.state='clean';r.engineVersion=proof.engineVersion;r.definitionsVersion=proof.definitionsVersion;this.#audit(id,'clean');
    }catch{r.state='rejected';await rm(r.file,{force:true});this.#audit(id,'rejected')}
    return {id,state:r.state,realCollection:false};
  }
  async capability({context,owner,id}={}){
    await this.#allowed(context,owner);await this.expire();const r=this.#records.get(id);
    if(!r||r.owner!==owner||r.state!=='clean'||r.expiresAt<=this.now())fail();
    if(this.#links.size>=200)throw Error('DOCUMENT_CAPABILITY_CAPACITY');
    const token=randomBytes(32).toString('base64url');
    this.#links.set(sha256(token),{id,owner,expiresAt:Math.min(this.now()+30000,r.expiresAt)});
    // A one-use capability for a future authenticated server route, NEVER a Storage public URL.
    return {token,expiresAt:Math.min(this.now()+30000,r.expiresAt)};
  }
  async read({context,owner,token}={}){
    await this.#allowed(context,owner);if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))fail();
    const key=sha256(token),link=this.#links.get(key),r=this.#records.get(link?.id);
    if(!link||link.owner!==owner||link.expiresAt<=this.now()||!r||r.owner!==owner||r.state!=='clean'||r.expiresAt<=this.now())fail();
    this.#links.delete(key);const stat=await lstat(r.file);if(!stat.isFile()||stat.isSymbolicLink())fail();
    const bytes=await readFile(r.file);
    if(r.state!=='clean'||r.expiresAt<=this.now()||sha256(bytes)!==r.hash||!await this.authorize(context,owner)){bytes.fill(0);fail()}
    return {bytes,mime:r.mime,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'attachment'}};
  }
  async remove({context,owner,id}={}){
    await this.#allowed(context,owner);const r=this.#records.get(id);if(!r||r.owner!==owner)fail();
    r.state='deleted';await rm(r.file,{force:true});this.#records.delete(id);
    for(const [key,link] of this.#links)if(link.id===id)this.#links.delete(key);this.#audit(id,'deleted');
  }
  async expire(){
    for(const [id,r] of this.#records)if(r.expiresAt<=this.now()||r.state==='rejected'){
      r.state='expired';await rm(r.file,{force:true});this.#records.delete(id);this.#audit(id,'expired');
    }
    for(const [key,link] of this.#links)if(link.expiresAt<=this.now()||!this.#records.has(link.id))this.#links.delete(key);
  }
  audit(){return this.#events.map(x=>({...x}))}
  async dispose(){if(!this.#ownsRoot)throw Error('WORKER_ROOT_NOT_OWNED');this.#ownsRoot=false;this.#initialized=false;for(const r of this.#records.values())r.state='deleted';this.#records.clear();this.#links.clear();await rm(this.#root,{recursive:true,force:true})}
}
