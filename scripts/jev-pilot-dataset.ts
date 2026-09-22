/** Offline training pilot preparation. Expected answers never enter the judge input. */
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, observeSyntheticCase, compactSyntheticJudgeInput, type SyntheticObservation } from "./synthetic-lab-adapter.js";
import { hash, stableJson } from "./jev-shadow.js";
import { splitByGroup, assertGroupDisjoint } from "./jev-offline.js";

type Json = Record<string, unknown>;
export type Answer = "pass" | "fail" | "insufficient";
export const LABEL_VERSION = "synthetic-observability-labels-v1";
export const CUTOFFS = ["2026-01-01T12:00:00Z", "2026-01-02T06:00:00Z", "2026-01-03T12:00:00Z"];
const SCENARIOS = new Set(["healthy", "benign_rename", "broken_trigger_reference", "conversion_trigger_mismatch", "meta_event_id_mismatch", "google_label_mismatch", "consent_bypass", "server_outage", "match_data_missing", "business_conversion_drop", "reporting_delay", "traffic_mix_shift", "checkout_trigger_mismatch", "client_claim_mismatch", "branch_filter_removed"]);
export interface Truth {
  case_id: string; scenario: string; injected_at: string | null; conversion_event: string;
  label_provenance: "synthetic_generator_rule_not_human_reviewed";
  expected_structural_validity: boolean; expected_container_tracking_fault: boolean;
}
export interface Expected {
  labelVersion: string; provenance: "synthetic_generator_rule_not_human_reviewed"; reviewStatus: "unreviewed";
  generatorTruth: { injectionActive: boolean; trackingFaultActive: boolean; containerFaultActive: boolean; trackingBehaviorPreserved: "pass"|"fail" };
  expectedAnswers: { evidenceSufficient: Answer; trackingBehaviorPreserved: Answer };
  deterministicReject: boolean; reasonCode: string;
}
export interface PilotRow {
  recordId: string; inputHash: string; canonicalInput: string; input: { observation: Json };
  provenance: { caseId: string; decisionTime: string; lineageGroup: string; topologyGroup: string; split: "train" };
  deterministicReject: boolean;
}
function obj(value: unknown, context: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${context}: expected object`);
  return value as Json;
}
function rows(value: unknown): Json[] { if (!Array.isArray(value)) throw new Error("expected rows"); return value.map(v=>obj(v,"row")); }
function instant(value: string): number {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("timestamp requires an explicit timezone");
  return Date.parse(value);
}
function count(value: unknown): number { if (typeof value!=="number" || !Number.isFinite(value) || value<0) throw new Error("invalid evidence count"); return value; }
export function parseTruth(value: unknown, caseId: string): Truth {
  const raw=obj(value,"truth");
  if (raw.case_id!==caseId || !SCENARIOS.has(String(raw.scenario)) || raw.label_provenance!=="synthetic_generator_rule_not_human_reviewed" || typeof raw.conversion_event!=="string" || !raw.conversion_event || typeof raw.expected_structural_validity!=="boolean" || typeof raw.expected_container_tracking_fault!=="boolean") throw new Error("invalid generator truth");
  if (raw.scenario==="healthy" ? raw.injected_at!==null : typeof raw.injected_at!=="string") throw new Error("invalid injection time");
  if(typeof raw.injected_at==="string")instant(raw.injected_at);
  const containerFault = !["healthy","benign_rename","server_outage","business_conversion_drop","reporting_delay","traffic_mix_shift"].includes(String(raw.scenario));
  if(raw.expected_structural_validity!==(raw.scenario!=="broken_trigger_reference") || raw.expected_container_tracking_fault!==containerFault) throw new Error("truth scenario contradicts generator flags");
  return raw as unknown as Truth;
}
function currentWindow(observation: SyntheticObservation): Json {
  const segments=rows(observation.facts.segments);
  if(!segments.length)throw new Error("missing observation windows");
  return segments[segments.length-1];
}
function requests(window: Json, platform?: string, source?: string, event?: string): Json[] {
  return rows(window.networkCounts).filter(n=>(!platform||n.platform===platform)&&(!source||n.source===source)&&(!event||n.eventName===event));
}
function total(items: Json[], key: string): number { return items.reduce((n,item)=>n+count(item[key]),0); }
function eligible(window: Json, event: string): number {
  return total(rows(window.siteConsent).filter(r=>r.event_name===event && r.ad_storage==="granted"),"count");
}
function latestReports(observation: SyntheticObservation, window: Json): Map<string, Json> {
  const start=instant(String(window.start));
  const result=new Map<string,Json>();
  for(const report of rows(observation.facts.availablePlatformSnapshots)) {
    if(instant(String(report.windowStart))>start || instant(String(report.windowEndExclusive))<=start)continue;
    const key=String(report.platform), old=result.get(key);
    if(!old||instant(String(report.observedAt))>instant(String(old.observedAt)))result.set(key,report);
  }
  return result;
}
/** Fault witnesses depend only on the evidence, never on hidden scenario names. */
function faultWitness(observation: SyntheticObservation, window: Json): boolean {
  const all=requests(window), segments=rows(observation.facts.segments), baseline=segments[0];
  if(total(all,"failedRequests")>0 || total(all,"deniedConsentRequests")>0 || count(obj(window.metaObservedPairing,"pairing").mismatchedPayloadEventIds)>0)return true;
  if(all.some(r=>count(r.requests)>count(r.uniqueLogicalEvents)))return true;
  const google=latestReports(observation,window).get("google_ads");
  if(google) {
    const labels=new Set(rows(google.conversionActions).map(a=>a.label));
    if(requests(window,"google_ads").some(r=>count(r.successfulRequests)>0 && Array.isArray(r.conversionLabels) && r.conversionLabels.some(l=>!labels.has(l))))return true;
  }
  if(segments.length<2)return false;
  for(const prior of requests(baseline)) {
    const current=requests(window,String(prior.platform),String(prior.source),String(prior.eventName));
    const consentKey=prior.platform==="ga4"?"analytics_storage":"ad_storage";
    const opportunities=total(rows(window.siteConsent).filter(r=>r.event_name===prior.eventName && r[consentKey]==="granted"),"count");
    if(count(prior.successfulRequests)>0 && opportunities>0 && total(current,"requests")===0)return true;
    if(prior.platform==="meta" && prior.source==="server" && count(prior.successfulRequests)>0 && count(prior.missingMatchFields)===0 && total(current,"missingMatchFields")>0)return true;
  }
  return false;
}
/** Generator truth is scoped by time; observable expected answers require an actual witness. */
export function expectedForObservation(observation: SyntheticObservation, truth: Truth): Expected {
  const injectionActive=truth.injected_at!==null && instant(observation.provenance.decisionTime)>=instant(truth.injected_at);
  const containerFaultActive=injectionActive&&truth.expected_container_tracking_fault;
  const trackingFaultActive=containerFaultActive||(injectionActive&&truth.scenario==="server_outage");
  const valid=Object.values(obj(observation.facts.containers,"containers")).every(c=>obj(obj(c,"container").activeValidation,"validation").valid===true);
  const expectedShape=!injectionActive||truth.expected_structural_validity;
  if(valid!==expectedShape)throw new Error("bounded shape evidence contradicts time-scoped truth");
  const base={labelVersion:LABEL_VERSION,provenance:truth.label_provenance,reviewStatus:"unreviewed" as const,
    generatorTruth:{injectionActive,containerFaultActive,trackingFaultActive,trackingBehaviorPreserved:trackingFaultActive?"fail" as const:"pass" as const},deterministicReject:!valid};
  const answer=(evidenceSufficient: Answer,trackingBehaviorPreserved: Answer,reasonCode: string):Expected=>({...base,expectedAnswers:{evidenceSufficient,trackingBehaviorPreserved},reasonCode});
  if(!valid)return answer("pass","fail","deterministic_reference_failure_skip_judge");
  const window=currentWindow(observation);
  if(faultWitness(observation,window))return answer("pass","fail","observed_tracking_fault");
  const reports=latestReports(observation,window);
  if(!reports.has("meta")||!reports.has("google_ads"))return answer("insufficient","insufficient","missing_matching_platform_reports");
  const google=reports.get("google_ads")!;
  const conversions=rows(google.events).map(e=>String(e.eventName));
  if(!count(window.visitorEvents)||!count(window.networkDeliveries)||!conversions.some(event=>eligible(window,event)>0))return answer("insufficient","insufficient","sparse_conversion_window");
  for(const event of conversions.filter(event=>eligible(window,event)>0)) {
    if(["meta","google_ads"].some(platform=>total(requests(window,platform,undefined,event),"successfulRequests")===0))return answer("insufficient","insufficient","missing_positive_conversion_coverage");
  }
  // Check every observed platform/event route. Meta compares source counts because browser/server IDs overlap.
  for(const platform of ["meta","google_ads"]) {
    const report=reports.get(platform)!;
    for(const delivered of requests(window,platform)) {
      const matched=rows(report.events).find(e=>e.eventName===delivered.eventName);
      const key=platform==="google_ads"?"uniqueEvents":delivered.source==="server"?"serverEvents":"browserEvents";
      if(!matched || count(matched[key])<count(delivered.uniqueLogicalEvents))return answer("insufficient","insufficient","unresolved_platform_report_gap");
    }
  }
  return answer("pass","pass","observed_tracking_preserved");
}
export function selectPilotRows(input: PilotRow[], limit=12, seed="jev-pilot-v1"): PilotRow[] {
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error("pilot limit must be 1..100");
  if(input.some(r=>r.provenance.split!=="train"))throw new Error("pilot accepts training rows only");
  const unique=new Map<string,PilotRow>();
  for(const row of [...input].sort((a,b)=>a.recordId.localeCompare(b.recordId))) {
    if(row.canonicalInput!==stableJson(row.input)||hash(row.input)!==row.inputHash)throw new Error("model input hash mismatch");
    if(!row.deterministicReject&&!unique.has(row.inputHash))unique.set(row.inputHash,row);
  }
  const buckets=new Map<string,PilotRow[]>();
  for(const row of unique.values()) {const key=row.provenance.decisionTime;const bucket=buckets.get(key)??[];bucket.push(row);buckets.set(key,bucket);}
  const times=[...buckets.keys()].sort();
  for(const bucket of buckets.values())bucket.sort((a,b)=>hash([seed,a.inputHash]).localeCompare(hash([seed,b.inputHash])));
  const selected:PilotRow[]=[];
  while(selected.length<limit) {let any=false;for(const time of times){const row=buckets.get(time)!.shift();if(row){any=true;selected.push(row);if(selected.length===limit)break;}}if(!any)break;}
  return selected;
}
async function readTruth(dataset: string, id: string): Promise<Truth> {
  if(!/^[A-Za-z0-9_-]+$/.test(id))throw new Error("invalid case identifier");
  const parent=await realpath(path.join(dataset,"ground-truth")), file=await realpath(path.join(parent,`${id}.json`));
  if(path.dirname(file)!==parent)throw new Error("truth path escapes ground-truth directory");
  return parseTruth(JSON.parse(await readFile(file,"utf8")),id);
}
export function validateRubric(value: unknown): Json {
  const rubric=obj(value,"rubric"), functions=obj(rubric.functions,"rubric functions");
  if(rubric.status!=="seed"||rubric.preprocessingVersion!=="synthetic-gtm-observation-v2"||typeof rubric.rubricVersion!=="string"||!rubric.rubricVersion.trim())throw new Error("pilot requires the frozen synthetic seed rubric");
  if(Object.keys(functions).sort().join(",")!=="evidenceSufficient,trackingBehaviorPreserved")throw new Error("rubric requires exactly two atomic functions");
  for(const item of Object.values(functions)) {
    const fn=obj(item,"function"), labels=obj(fn.labels,"labels");
    if(typeof fn.description!=="string"||!fn.description.trim()||Object.keys(labels).sort().join(",")!=="fail,insufficient,pass"||Object.values(labels).some(v=>typeof v!=="string"||!v.trim()))throw new Error("invalid rubric function");
  }
  return rubric;
}
async function verifySourceFile(dataset: string, name: string, inventory: Json): Promise<void> {
  const root=await realpath(dataset), target=await realpath(path.join(root,name)), relative=path.relative(root,target);
  if(relative.startsWith("..")||path.isAbsolute(relative))throw new Error("source path escapes dataset");
  if(createHash("sha256").update(await readFile(target)).digest("hex")!==inventory[name])throw new Error(`source checksum mismatch: ${name}`);
}
export async function preparePilot(dataset: string, output: string, rubricFile: string, limit=12): Promise<Json> {
  try {await lstat(output);throw new Error("output already exists; refusing to overwrite");}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const manifest=await loadManifest(dataset);
  if(manifest.schema_version!=="2.0.0")throw new Error("time-aware pilot requires a v2 direct dataset root");
  const checksumBytes=await readFile(path.join(dataset,"checksums.json"));
  const inventory=obj(JSON.parse(checksumBytes.toString("utf8")),"checksum inventory");
  await verifySourceFile(dataset,"manifest.json",inventory);
  // Use the frozen checksum inventory to audit reserved baseline identities without opening their contents.
  const partition=splitByGroup(manifest.cases.map(item=>{
    const baseline=["web","server"].map(side=>inventory[`${item.directory}/${side}-before.json`]);
    if(baseline.some(value=>typeof value!=="string"||!/^[a-f0-9]{64}$/.test(value)))throw new Error("missing baseline checksum");
    return {input:{},prediction:{status:"unavailable" as const,reason:"partition audit only"},provenance:{containerGroup:item.container_group!,lineageGroup:item.lineage_group!,topologyGroup:item.topology_group,baselineGroup:hash(baseline),plannedSplit:item.split,synthetic:true,samplingReasons:[]}};
  }));
  assertGroupDisjoint(partition);
  const rubric=validateRubric(JSON.parse(await readFile(rubricFile,"utf8")));
  const rubricHash=hash(rubric), inputs:PilotRow[]=[], expected:Json[]=[], selectedCases=manifest.cases.filter(c=>c.split==="train");
  if(!selectedCases.length)throw new Error("dataset contains no training cases");
  const equivalentAnswers=new Map<string,string>();
  for(const item of selectedCases) {
    for(const file of ["web-before.json","server-before.json","web-after.json","server-after.json","container-history.json","data-layer.jsonl","network-events.jsonl","platform-snapshots.jsonl"])await verifySourceFile(dataset,`${item.directory}/${file}`,inventory);
    await verifySourceFile(dataset,`ground-truth/${item.case_id}.json`,inventory);
    const truth=await readTruth(dataset,item.case_id);
    for(const cutoff of CUTOFFS) {
      const observation=await observeSyntheticCase(dataset,item.case_id,cutoff);
      const label=expectedForObservation(observation,truth), input={observation:compactSyntheticJudgeInput(observation)}, inputHash=hash(input);
      const answers=stableJson(label.expectedAnswers), previous=equivalentAnswers.get(inputHash);
      if(previous!==undefined && previous!==answers)throw new Error("equivalent model inputs have conflicting expected answers");
      equivalentAnswers.set(inputHash,answers);
      const recordId=hash([item.case_id,observation.provenance.decisionTime]);
      inputs.push({recordId,inputHash,canonicalInput:stableJson(input),input,deterministicReject:label.deterministicReject,
        provenance:{caseId:item.case_id,decisionTime:observation.provenance.decisionTime,lineageGroup:item.lineage_group!,topologyGroup:item.topology_group!,split:"train"}});
      expected.push({recordId,inputHash,rubricHash,...label});
    }
  }
  const pilot=selectPilotRows(inputs,limit), selectedIds=new Set(pilot.map(r=>r.recordId));
  await verifySourceFile(dataset,"manifest.json",inventory);
  const sourceManifestHash=createHash("sha256").update(await readFile(path.join(dataset,"manifest.json"))).digest("hex");
  const preparationSourceHashes=Object.fromEntries(await Promise.all(["jev-pilot-dataset.ts","synthetic-lab-adapter.ts","jev-offline.ts","jev-shadow.ts"].map(async name=>[name,createHash("sha256").update(await readFile(new URL(name,import.meta.url))).digest("hex")])));
  const summary={preparationSourceHashes,schemaVersion:"jev-pilot-package-v1",mode:"offline-preparation",providerCalls:0,rubricHash,sourceManifestHash,sourceInventoryHash:createHash("sha256").update(checksumBytes).digest("hex"),labelVersion:LABEL_VERSION,
    trainingCases:selectedCases.length,trainingObservations:inputs.length,deterministicRejects:inputs.filter(r=>r.deterministicReject).length,
    pilotObservations:pilot.length,maxAtomicEvaluations:pilot.length*2,selection:"training only; deterministic rejects excluded; exact input deduplication; seeded hash order, round-robin by decision time",
    reservedCases:{validation:manifest.cases.filter(c=>c.split==="validation").length,holdout:manifest.cases.filter(c=>c.split==="holdout").length},
    reservedInputsRead:0,reservedLabelsRead:0,liveReadiness:"requires explicit provider/model, credentials and budget settings; no live evaluation performed"};
  await mkdir(path.dirname(path.resolve(output)),{recursive:true});await mkdir(output);
  const jsonl=(items: unknown[])=>items.map(x=>JSON.stringify(x)).join("\n")+"\n";
  const files:Record<string,string>={"rubric.json":stableJson(rubric)+"\n","train-inputs.jsonl":jsonl(inputs),"train-expected.jsonl":jsonl(expected),"pilot-inputs.jsonl":jsonl(pilot),"pilot-expected.jsonl":jsonl(expected.filter(r=>selectedIds.has(String(r.recordId)))),"manifest.json":JSON.stringify(summary,null,2)+"\n"};
  for(const [name,text] of Object.entries(files))await writeFile(path.join(output,name),text);
  await writeFile(path.join(output,"checksums.json"),JSON.stringify(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,createHash("sha256").update(text).digest("hex")])),null,2)+"\n");
  await writeFile(path.join(output,"REPORT.md"),`# Frozen training pilot package\n\n${inputs.length} time-bounded training observations from ${selectedCases.length} cases. ${pilot.length} unique, structurally valid observations selected without consulting labels, for at most ${pilot.length*2} atomic function evaluations. Provider calls: 0.\n\n${summary.deterministicRejects} deterministic reference failures are retained in the dataset and excluded from model calls. Validation and holdout inputs and labels were not opened by this preparation. Their partition identities were audited using manifest metadata and inventory hashes only; reserved contents were not rehashed.\n\nExpected answers are generator-defined and unreviewed. They distinguish latent injected faults from observable witnesses and withhold conclusions for missing or delayed reports. Only each row's input.observation is selected by the saved Jev functions; provenance and expected files are excluded.\n\nRubric SHA-256: ${rubricHash}\n\n${summary.liveReadiness}.\n`);
  return summary;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), options:Record<string,string>={};
  for(let i=0;i<args.length;i+=2){if(!["--dataset","--output","--rubric","--limit"].includes(args[i])||!args[i+1])throw new Error("expected --dataset PATH --output NEW_PATH [--rubric PATH] [--limit N]");options[args[i]]=args[i+1];}
  if(!options["--dataset"]||!options["--output"])throw new Error("dataset and output required");
  console.log(JSON.stringify(await preparePilot(options["--dataset"],options["--output"],options["--rubric"]??"DOCUMENTATION/jev-shadow-pilot/rubric-v1.json",options["--limit"]?Number(options["--limit"]):12),null,2));
}
