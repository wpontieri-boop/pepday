// Strict TEST quarantine. The only enabled scanner is the exact known synthetic sample allowlist.
import {SAMPLE,SAMPLE_SHA} from './portal-core.mjs';
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export async function scanSyntheticBytes(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length!==68)return {status:'rejected',engine:'synthetic_sha256_allowlist'};
 const clean=await sha(bytes)===SAMPLE_SHA;
 return {status:clean?'clean':'rejected',engine:'synthetic_sha256_allowlist',sha256:await sha(bytes),definitionsVersion:'fixed-sample-v1'};
}
export class SyntheticQuarantine {
 #records=new Map();
 constructor({scanner=scanSyntheticBytes,now=()=>Date.now()}={}){this.scanner=scanner;this.now=now}
 async put({owner,bytes,mime}){
 if(typeof owner!=='string'||!/^QA-[A-Za-z0-9_-]{1,80}$/.test(owner)||!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>5242880||mime!=='image/png')throw Error('QUARANTINE_INPUT_DENIED');
 for(const [old,r] of this.#records)if(this.now()-r.at>120000){r.bytes.fill(0);this.#records.delete(old)}
 if(this.#records.size>=5)throw Error('QUARANTINE_CAPACITY');
 const id=crypto.randomUUID(),copy=new Uint8Array(bytes),hash=await sha(copy);
 this.#records.set(id,{owner,bytes:copy,hash,status:'quarantined',at:this.now()});
 let receipt;try{receipt=await this.scanner(new Uint8Array(copy))}catch{receipt={status:'unavailable'}}
 const r=this.#records.get(id);
 if(receipt?.status==='clean'&&receipt.sha256===hash&&receipt.engine==='synthetic_sha256_allowlist'&&receipt.definitionsVersion==='fixed-sample-v1'&&hash===SAMPLE_SHA&&this.now()-r.at<=120000)r.status='clean';
 else {r.status='rejected';r.bytes.fill(0)}
 return {id,status:r.status,realUpload:false,engine:'synthetic_sha256_allowlist'};
 }
 async read({owner,id}){
 const r=this.#records.get(id);
 if(!r||r.owner!==owner||r.status!=='clean'||this.now()-r.at>120000||await sha(r.bytes)!==r.hash)throw Error('QUARANTINE_ACCESS_DENIED');
 return new Uint8Array(r.bytes);
 }
 remove({owner,id}){const r=this.#records.get(id);if(!r||r.owner!==owner)throw Error('QUARANTINE_ACCESS_DENIED');r.bytes.fill(0);this.#records.delete(id);return true}
}
export const syntheticSampleBytes=()=>Uint8Array.from(atob(SAMPLE),x=>x.charCodeAt(0));
