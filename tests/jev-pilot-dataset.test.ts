import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expectedForObservation, parseTruth, preparePilot, selectPilotRows, validateRubric, type PilotRow, type Truth } from "../scripts/jev-pilot-dataset.js";
import { hash, stableJson } from "../scripts/jev-shadow.js";
import type { SyntheticObservation } from "../scripts/synthetic-lab-adapter.js";

type Json = Record<string, any>;
const root=fileURLToPath(new URL("../",import.meta.url));
const rubric=path.join(root,"DOCUMENTATION/jev-shadow-pilot/rubric-v1.json");
const start="2026-01-01T00:00:00Z", drift="2026-01-02T00:00:00Z", end="2026-01-03T00:00:00Z";
function truth(scenario="healthy"): Truth {
  return parseTruth({case_id:"case-a",scenario,conversion_event:"purchase",injected_at:scenario==="healthy"?null:drift,
    label_provenance:"synthetic_generator_rule_not_human_reviewed",expected_structural_validity:scenario!=="broken_trigger_reference",
    expected_container_tracking_fault:!["healthy","server_outage","reporting_delay","business_conversion_drop","traffic_mix_shift","benign_rename"].includes(scenario)},"case-a");
}
function fixture(): SyntheticObservation {
  const networkCounts=["meta","google_ads"].map(platform=>({platform,source:"browser",eventName:"purchase",requests:2,successfulRequests:2,failedRequests:0,uniqueLogicalEvents:2,missingMatchFields:0,deniedConsentRequests:0,conversionLabels:platform==="google_ads"?["valid"]:[]}));
  const segment={start:drift,end,visitorEvents:2,networkDeliveries:4,siteConsent:[{event_name:"purchase",ad_storage:"granted",analytics_storage:"granted",count:2}],networkCounts,metaObservedPairing:{mismatchedPayloadEventIds:0}};
  return {provenance:{source:"synthetic-gtm-lab",datasetSchema:"2.0.0",lineageGroup:"L",caseId:"case-a",decisionTime:"2026-01-03T12:00:00Z",synthetic:true},cautions:[],facts:{
    containers:{web:{activeValidation:{valid:true},changedEntities:[]},server:{activeValidation:{valid:true},changedEntities:[]}},
    segments:[{...structuredClone(segment),start,end:drift},segment],
    availablePlatformSnapshots:["meta","google_ads"].map(platform=>({platform,windowStart:drift,windowEndExclusive:end,observedAt:"2026-01-03T12:00:00Z",conversionActions:[{label:"valid"}],events:[{eventName:"purchase",uniqueEvents:2,browserEvents:2,serverEvents:0}]}))}};
}
const answers=(observation:SyntheticObservation,t=truth())=>expectedForObservation(observation,t).expectedAnswers;

test("pre-drift hidden fault cannot become an observed failure",()=>{
  const obs=fixture();obs.provenance.decisionTime="2026-01-01T12:00:00Z";obs.facts.availablePlatformSnapshots=[];
  const result=expectedForObservation(obs,truth("meta_event_id_mismatch"));
  assert.equal(result.generatorTruth.trackingFaultActive,false);
  assert.deepEqual(result.expectedAnswers,{evidenceSufficient:"insufficient",trackingBehaviorPreserved:"insufficient"});
});
test("expected answers follow visible evidence rather than hidden scenario or conversion name",()=>{
  const obs=fixture(), fault=truth("meta_event_id_mismatch");
  assert.deepEqual(answers(obs),answers(obs,fault));
  const segments=obs.facts.segments as Json[];segments[1].metaObservedPairing.mismatchedPayloadEventIds=1;
  assert.deepEqual(answers(obs),{evidenceSufficient:"pass",trackingBehaviorPreserved:"fail"});
  assert.deepEqual(answers(obs),answers(obs,{...fault,conversion_event:"hidden-event"}));
});
test("outage witnesses fail behavior without blaming a container",()=>{
  const obs=fixture();(obs.facts.segments as Json[])[1].networkCounts[0].failedRequests=1;
  const result=expectedForObservation(obs,truth("server_outage"));
  assert.equal(result.generatorTruth.containerFaultActive,false);assert.equal(result.generatorTruth.trackingFaultActive,true);
  assert.equal(result.expectedAnswers.trackingBehaviorPreserved,"fail");
});
test("positive tracking needs both aligned reports, including settled Meta source counts",()=>{
  const obs=fixture();assert.equal(answers(obs).trackingBehaviorPreserved,"pass");
  const reports=obs.facts.availablePlatformSnapshots as Json[];
  reports[0].events[0].browserEvents=1;
  assert.equal(answers(obs).trackingBehaviorPreserved,"insufficient");
  reports[0].events[0].browserEvents=2;reports[1].events[0].uniqueEvents=1;
  assert.equal(answers(obs,truth("reporting_delay")).trackingBehaviorPreserved,"insufficient");
  reports[1].events[0].uniqueEvents=2;reports[1].windowStart=start;reports[1].windowEndExclusive=drift;
  assert.equal(answers(obs).trackingBehaviorPreserved,"insufficient");
});
test("missing routes need observed baseline and current consented opportunities",()=>{
  const obs=fixture(), facts=obs.facts as Json;
  facts.segments[1].networkCounts.pop();
  assert.equal(answers(obs).trackingBehaviorPreserved,"fail");
  facts.segments[1].siteConsent[0].ad_storage="denied";
  assert.equal(answers(obs).trackingBehaviorPreserved,"insufficient");
});
test("missing conversion delivery cannot pass even when no prior route was observed",()=>{
  const obs=fixture(), facts=obs.facts as Json;
  for(const segment of facts.segments)segment.networkCounts.pop();
  assert.equal(answers(obs).trackingBehaviorPreserved,"insufficient");
});
test("reference failure bypasses the judge and inconsistent truth is rejected",()=>{
  const obs=fixture();(obs.facts.containers as Json).web.activeValidation.valid=false;
  const label=expectedForObservation(obs,truth("broken_trigger_reference"));
  assert.equal(label.deterministicReject,true);assert.equal(label.expectedAnswers.evidenceSufficient,"pass");
  assert.throws(()=>expectedForObservation(obs,truth()),/shape evidence/);
  assert.throws(()=>parseTruth({...truth(),expected_container_tracking_fault:true},"case-a"),/contradicts/);
});
function row(id:string,time:string,input={observation:{facts:{value:id}}}): PilotRow {
  return {recordId:id,inputHash:hash(input),canonicalInput:stableJson(input),input,deterministicReject:false,provenance:{caseId:id,decisionTime:time,lineageGroup:"L",topologyGroup:"T",split:"train"}};
}
test("selection is stable, time-balanced, deduplicated, training-only, and hash-checked",()=>{
  const a=row("a","1"),b=row("b","2"),c={...a,recordId:"c"},reject={...row("d","2"),deterministicReject:true};
  assert.deepEqual(selectPilotRows([reject,c,b,a]),[a,b]);assert.deepEqual(selectPilotRows([a,b,c,reject]),[a,b]);
  assert.throws(()=>selectPilotRows([{...a,canonicalInput:"{}"}]),/hash mismatch/);
  assert.throws(()=>selectPilotRows([{...a,inputHash:"wrong"}]),/hash mismatch/);
  assert.throws(()=>selectPilotRows([{...a,provenance:{...a.provenance,split:"holdout" as "train"}}]),/training/);
  assert.throws(()=>selectPilotRows([a],0),/limit/);
});
test("rubric rejects incomplete function and label definitions",async()=>{
  const source=JSON.parse(await readFile(rubric,"utf8"));validateRubric(source);
  delete source.functions.evidenceSufficient.labels.insufficient;assert.throws(()=>validateRubric(source),/invalid rubric/);
});
test("compiler opens only training data, isolates labels, and detects source corruption",{timeout:60000},async()=>{
  const temp=await mkdtemp("/private/tmp/jev-pilot-test-"),dataset=path.join(temp,"dataset"),output=path.join(temp,"pilot");
  try {
    await promisify(execFile)("python3",[path.join(root,"scripts/synthetic-lab/generate_multi.py"),"--output",dataset,"--seed","7","--sessions-per-hour","1"]);
    const manifest=JSON.parse(await readFile(path.join(dataset,"manifest.json"),"utf8"));
    for(const item of manifest.cases.filter((c:Json)=>c.split!=="train")){
      await rm(path.join(dataset,item.directory),{recursive:true});await rm(path.join(dataset,"ground-truth",`${item.case_id}.json`));
    }
    const summary=await preparePilot(dataset,output,rubric);
    assert.equal(summary.trainingObservations,39);assert.equal(summary.reservedInputsRead,0);assert.equal(summary.reservedLabelsRead,0);
    const inputs=(await readFile(path.join(output,"pilot-inputs.jsonl"),"utf8")).trim().split("\n").map(s=>JSON.parse(s));
    assert.equal(inputs.length,12);
    for(const row of inputs){assert.deepEqual(Object.keys(row.input),["observation"]);assert.equal(row.canonicalInput,stableJson(row.input));
      for(const secret of [row.provenance.caseId,row.provenance.lineageGroup,"expectedAnswers","generatorTruth","label_provenance"])assert.ok(!row.canonicalInput.includes(secret),secret);
    }
    const all=(await readFile(path.join(output,"train-inputs.jsonl"),"utf8")).trim().split("\n").map(s=>JSON.parse(s));
    const expected=(await readFile(path.join(output,"train-expected.jsonl"),"utf8")).trim().split("\n").map(s=>JSON.parse(s));
    const signatures=new Map<string,string>();
    for(let i=0;i<all.length;i++){const key=all[i].inputHash, value=stableJson(expected[i].expectedAnswers);assert.equal(signatures.get(key)??value,value);signatures.set(key,value);}
    await assert.rejects(preparePilot(dataset,output,rubric),/refusing to overwrite/);
    const training=manifest.cases.find((c:Json)=>c.split==="train");
    const file=path.join(dataset,"ground-truth",`${training.case_id}.json`),bytes=await readFile(file,"utf8");await writeFile(file,bytes+" ");
    await assert.rejects(preparePilot(dataset,path.join(temp,"bad"),rubric),/source checksum mismatch/);
  }finally{await rm(temp,{recursive:true,force:true});}
});
