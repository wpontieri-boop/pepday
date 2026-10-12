// Server-side adapter only. Never bundled into site/src or called by the portal.
import {spawn} from 'node:child_process';
import {lstat,readFile,open} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export function runBinary(binary,args,{timeoutMs=20000,env=process.env}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{shell:false,env,stdio:['ignore','pipe','pipe']});
    let output='',done=false;
    const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);err?reject(err):resolve(value)};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('SCANNER_TIMEOUT'))},timeoutMs);
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{
      output+=chunk.toString();if(output.length>65536){child.kill('SIGKILL');finish(Error('SCANNER_OUTPUT_LIMIT'))}
    });
    child.on('error',()=>finish(Error('SCANNER_UNAVAILABLE')));
    child.on('close',(code,signal)=>finish(null,{code,signal,output}));
  });
}

export class ClamAVScanner {
  constructor({binary,definitionsDir,env=process.env,now=()=>Date.now(),timeoutMs=20000}={}){
    if(!path.isAbsolute(binary||'')||!path.isAbsolute(definitionsDir||''))throw Error('SCANNER_CONFIGURATION_REQUIRED');
    Object.assign(this,{binary,definitionsDir,env,now,timeoutMs});
  }
  async scan(file){
    const denied={status:'unavailable',engine:'clamav'};
    try{
      const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>5242880)return denied;
      const input=await readFile(file),digest=sha256(input);
      let daily;
      for(const name of ['daily.cvd','daily.cld']){
        try{const p=path.join(this.definitionsDir,name),s=await lstat(p);if(s.isFile()&&!s.isSymbolicLink())daily=p}catch{}
      }
      if(!daily)return {...denied,reason:'DEFINITIONS_MISSING'};
      // CVD/CLD headers contain the build epoch, not the download mtime.
      const handle=await open(daily,'r'),headerBytes=Buffer.alloc(512);
      let bytesRead;try{({bytesRead}=await handle.read(headerBytes,0,512,0))}finally{await handle.close()}
      const header=headerBytes.subarray(0,bytesRead).toString('ascii').trim().split(':');
      const epoch=Number(header[8])*1000;
      if(header[0]!=='ClamAV-VDB'||!Number.isFinite(epoch)||epoch<=0||this.now()-epoch>48*3600000||epoch>this.now()+300000)return {...denied,reason:'DEFINITIONS_STALE'};
      const version=await runBinary(this.binary,['--version'],{env:this.env,timeoutMs:this.timeoutMs});
      if(version.code!==0||!/^ClamAV \d+\.\d+\.\d+/.test(version.output.trim()))return denied;
      const result=await runBinary(this.binary,[`--database=${this.definitionsDir}`,'--official-db-only=yes','--fail-if-cvd-older-than=2','--no-summary','--alert-exceeds-max=yes','--max-filesize=5M','--max-scansize=20M','--max-files=100','--max-recursion=8','--max-scantime=15000','--',file],{env:this.env,timeoutMs:this.timeoutMs});
      // The engine validates signed CVDs. Any loading/scanning error is denied.
      if(result.signal||![0,1].includes(result.code)||sha256(await readFile(file))!==digest||result.code===0&&(!/: OK\s*$/.test(result.output)||/ERROR/.test(result.output)))return denied;
      return {status:result.code===0?'clean':'infected',engine:'clamav',engineVersion:version.output.trim().split('/')[0],definitionsVersion:header[2],definitionsAt:epoch,sha256:digest,scannedAt:this.now()};
    }catch{return denied}
  }
}
