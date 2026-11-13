import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePwaTelemetry, insertPwaTelemetryQa, LIMITS } from '../scripts/security/pwa-telemetry-limit-qa.mjs';
const A='a3ebf624-86e8-4339-946c-8136c5d4f034';
const B='b2ed246c-b53d-451e-9e2e-663c6c8b5fad';
const make=(i=0, installationId=A, eventType='standalone_launch') => ({
  eventId:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,
  installationId, eventType, platform:'android'
});
const T=1_800_000_000_000;
function seed(count,installationId=A,time=T-1000,offset=0){return Array.from({length:count},(_,i)=>({...make(i+offset,installationId),createdAtMs:time}));}

test('normal anonymous installed event is accepted without credentials',()=>{
  const r=insertPwaTelemetryQa([],make(0,A,'installed'),T);
  assert.equal(r.decision.recorded,true);
  assert.equal(r.history.length,1);
});
test('event UUID and installed installation UUID remain idempotent',()=>{
  let first=insertPwaTelemetryQa([],make(0,A,'installed'),T);
  assert.equal(insertPwaTelemetryQa(first.history,make(0,A,'installed'),T+1).decision.reason,'duplicate_event');
  assert.equal(insertPwaTelemetryQa(first.history,make(10,A,'installed'),T+1).decision.reason,'duplicate_installation');
  assert.equal(first.history.length,1);
});
test('per-installation limit is exact and rejects only excess hour',()=>{
  const history=seed(LIMITS.perInstallationPerHour-1);
  assert.equal(decidePwaTelemetry({history,event:make(100,A),nowMs:T}).recorded,true);
  assert.equal(decidePwaTelemetry({history:seed(LIMITS.perInstallationPerHour),event:make(100,A),nowMs:T}).reason,'installation_limit');
});
test('global limit is independent of installation UUID, mitigating rotating IDs',()=>{
  const rows=Array.from({length:LIMITS.globalPerHour},(_,i)=>({...make(i,i%2?A:B),createdAtMs:T-1000}));
  assert.equal(decidePwaTelemetry({history:rows,event:make(400,A),nowMs:T}).reason,'global_limit');
});
test('events outside sliding hour do not count, boundary is strict',()=>{
  const old=seed(20,A,T-60*60*1000);
  assert.equal(decidePwaTelemetry({history:old,event:make(100,A),nowMs:T}).recorded,true);
});
test('invalid UUID, event type, platform, and clock fail closed',()=>{
  for(const event of [{...make(0),installationId:'../../'}, {...make(0),eventType:'delete'}, {...make(0),platform:'hidden'}, {...make(0),eventId:'abc'}]){
    assert.equal(decidePwaTelemetry({history:[],event,nowMs:T}).reason,'invalid');
  }
  assert.equal(decidePwaTelemetry({history:[],event:make(0),nowMs:NaN}).reason,'invalid');
});
test('invalid history cannot bypass rate limit and never mutates source',()=>{
  const history=seed(1);history.push({...make(101),createdAtMs:T+1000});
  const before=JSON.stringify(history);
  assert.equal(decidePwaTelemetry({history,event:make(103),nowMs:T}).reason,'invalid_history');
  assert.equal(JSON.stringify(history),before);
});
test('the model does not pretend to be deployed or concurrency-safe',()=>{
  assert.deepEqual(Object.keys(LIMITS).sort(),['globalPerHour','perInstallationPerHour']);
  assert.equal(LIMITS.globalPerHour,240);
  assert.equal(LIMITS.perInstallationPerHour,12);
});
