import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evaluateGtmSignalQuality, type GtmContainer } from "../evals/eval_gtm_signal_quality.js";
import { buildEvidence, freezeSeedDefinition, PythonJevJudge, hash, manifestHash, frozenDefinitionFromManifest, FakeJudge, shadowPolicy } from "../scripts/jev-shadow.js";
import { replayReport, splitByGroup, assertGroupDisjoint, type DatasetRow } from "../scripts/jev-offline.js";
const worker=path.resolve("scripts/jev_worker.py");
async function evidence(frozen=freezeSeedDefinition()) {
  const base=JSON.parse(await readFile("content/gtm-templates/BLADE/seed/blade-web.json","utf8")) as GtmContainer;
  const scores=evaluateGtmSignalQuality(base);
  return buildEvidence({parentId:"p",baseline:base,candidate:base,operations:[],targetedIssue:"test",before:scores,after:{...scores,combinedScore:scores.combinedScore+0.01},validation:{valid:true,reason:"OK",changedEntityIds:{tag:[],trigger:[],variable:[],folder:[]}},qa:{status:"passed"},frozen});
}
async function fixture() {
  const dir=await mkdtemp(path.join(os.tmpdir(),"jev-worker-"));
  const manifestPath=path.join(dir,"manifest.json"), calls=path.join(dir,"calls.txt"), closed=path.join(dir,"closed.txt");
  const definition={candidate:{model:"mock-model",note:"é"},backend:{provider:"mock-provider",model:"mock-model"},selected_columns:["qa"],column_mode:"explicit"};
  const spec={path:"x",definitionHash:hash(definition),provider:"mock-provider",model:"mock-model"};
  const payload={definitionHash:"definition-seed",requestedModel:"mock-model",preprocessingVersion:"v1",policyVersion:"p1",functions:{evidenceSufficient:spec,trackingBehaviorPreserved:{...spec,path:"y"}}};
  const manifest={...payload,manifestHash:manifestHash(payload)};
  const e=await evidence(frozenDefinitionFromManifest(manifest));
  await writeFile(path.join(dir,"jev_align.py"), `import json, os
class Prediction:
 choice="pass"; confidence=0.8; probabilities={"pass":0.8}; resolved_model="mock-model"
class F:
 def __init__(self,path):
  self.path=path
  self._definition=json.loads(${JSON.stringify(JSON.stringify(definition))})
  self._state=object(); self._backend=object()
  if path == "y" and os.environ.get("MUTATE_SECOND"): self._definition["selected_columns"]=["different"]
 def __call__(self,**kwargs):
  with open(os.environ["CALLS"],"a") as handle: handle.write(self.path)
  print("runtime diagnostic")
  return Prediction()
 def close(self):
  with open(os.environ["CLOSED"],"a") as handle: handle.write(self.path)
class AIFunction:
 @staticmethod
 def load(path): return F(path)
`);
  await Promise.all([writeFile(manifestPath,JSON.stringify(manifest)),writeFile(calls,""),writeFile(closed,"")]);
  return {dir,manifestPath,calls,closed,manifest,e,judge:(extra:NodeJS.ProcessEnv={})=>new PythonJevJudge("python3",worker,manifestPath,1000,4096,{PYTHONPATH:dir,CALLS:calls,CLOSED:closed,...extra})};
}
test("real Python worker binds Unicode identity and reads upstream atomic Prediction fields",async()=>{
  const f=await fixture();
  try {
    const result=await f.judge().judge(f.e);
    assert.equal(result.status,"success");
    if(result.status==="success") { assert.equal(result.reportedModel,"mock-model"); assert.ok(Math.abs(result.uncertainty!-0.2)<1e-9); }
    assert.equal(await readFile(f.calls,"utf8"),"xy");
    assert.equal(await readFile(f.closed,"utf8"),"xy");
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});
test("a changed second loaded definition prevents both provider calls",async()=>{
  const f=await fixture();
  try {
    // The manifest and evidence are unchanged. Only the second loaded runtime differs.
    const result=await f.judge({MUTATE_SECOND:"1"}).judge(f.e);
    assert.equal(result.status,"error");
    if(result.status==="error") assert.equal(result.reason,"loaded function identity mismatch");
    assert.equal(await readFile(f.calls,"utf8"),"");
    assert.equal(await readFile(f.closed,"utf8"),"xy");
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});
test("a rehashed manifest cannot replace the snapshot frozen at run start",async()=>{
  const f=await fixture();
  try {
    const changed={...f.manifest,functions:{...f.manifest.functions,trackingBehaviorPreserved:{...f.manifest.functions.trackingBehaviorPreserved,model:"changed"}}};
    changed.manifestHash=manifestHash(changed);
    await writeFile(f.manifestPath,JSON.stringify(changed));
    const result=await f.judge().judge(f.e);
    assert.equal(result.status,"error");
    if(result.status==="error") assert.equal(result.reason,"frozen manifest identity mismatch");
    assert.equal(await readFile(f.calls,"utf8"),"");
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});
test("offline report uses class denominators and stable connected group splits",()=>{
  const row=(group:string,lineage:string,label:"pass"|"fail",route:"keep"|"review"|"revert"):DatasetRow & {route:typeof route}=>({input:{evidenceHash:group},prediction:{status:"unavailable",reason:"fake"},provenance:{containerGroup:group,lineageGroup:lineage,synthetic:true,samplingReasons:[]},label:{evidenceHash:group,trackingBehaviorPreserved:label,reviewer:"synthetic",reviewedAt:"now"},route});
  const rows=[row("a","one","fail","keep"),row("b","two","fail","review"),row("c","three","pass","revert"),row("d","four","pass","review")];
  const report=replayReport(rows);
  assert.equal(report.harmfulChangeApprovalRate,0.5); assert.equal(report.validFixRejectionRate,0.5);
  const linked=[row("A","shared","pass","review"),row("B","shared","pass","review"),row("B","other","pass","review")];
  const split=splitByGroup(linked),permuted=splitByGroup([...linked].reverse());
  assertGroupDisjoint(split); assert.equal(Object.values(split).filter(v=>v.length).length,1);
  assert.deepEqual(Object.values(split).map(v=>v.length),Object.values(permuted).map(v=>v.length));
  const repeated=splitByGroup([...linked,linked[0]]);
  assert.equal(Object.values(repeated).findIndex(v=>v.length===4),Object.values(split).findIndex(v=>v.length===3));
});
test("loading a valid frozen manifest remains uncalibrated and routes review",async()=>{
  assert.throws(()=>frozenDefinitionFromManifest({}));
  const f=await fixture();
  try {
    assert.equal(f.e.frozen.status,"seed"); assert.equal(f.e.frozen.contentHash,f.manifest.manifestHash);
    assert.equal(shadowPolicy(f.e,await new FakeJudge().judge(f.e)).route,"review");
    assert.throws(()=>frozenDefinitionFromManifest({...f.manifest,requestedModel:"changed"}),/content hash/);
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});
test("subprocess startup, oversized output and ignored termination fail closed",async()=>{
  const f=await fixture();
  try {
    const missing=await new PythonJevJudge(path.join(f.dir,"missing-python"),worker,f.manifestPath,1000).judge(f.e);
    assert.equal(missing.status,"unavailable");
    const noisy=path.join(f.dir,"noisy.py");
    await writeFile(noisy,'import sys\nsys.stdin.read()\nsys.stdout.write(" " * 5000)\nsys.stdout.flush()\n');
    const oversized=await new PythonJevJudge("python3",noisy,f.manifestPath,1000,1024).judge(f.e);
    assert.equal(oversized.status,"unavailable");
    if(oversized.status==="unavailable") assert.equal(oversized.reason,"worker output exceeded limit");
    const stubborn=path.join(f.dir,"stubborn.py");
    await writeFile(stubborn,'import signal, sys, time\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nsys.stdin.read()\ntime.sleep(30)\n');
    const timed=await new PythonJevJudge("python3",stubborn,f.manifestPath,250).judge(f.e);
    assert.equal(timed.status,"unavailable");
    if(timed.status==="unavailable") assert.equal(timed.reason,"worker timeout");
  } finally { await rm(f.dir,{recursive:true,force:true}); }
});
