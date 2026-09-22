/** Adapter for the separately maintained synthetic GTM drift lab. It never reads oracle labels. */
import { readFile } from "node:fs/promises";
import path from "node:path";
export interface LabManifest { schema_version:string; lineage_group:string; synthetic:true; cases:Array<{case_id:string;directory:string}>; }
type Json=Record<string,unknown>;
async function jsonl(file:string):Promise<Json[]>{return (await readFile(file,"utf8")).trim().split("\n").filter(Boolean).map(line=>JSON.parse(line) as Json);}
function before(rows:Json[], field:string, cutoff:string):Json[]{return rows.filter(row=>typeof row[field]==="string"&&(row[field] as string)<=cutoff);}
export async function loadManifest(root:string):Promise<LabManifest>{return JSON.parse(await readFile(path.join(root,"datasets/demo-v1/manifest.json"),"utf8")) as LabManifest;}
export async function observeSyntheticCase(root:string, caseId:string, decisionTime:string):Promise<{ provenance:Json; facts:Json; cautions:string[] }>{
 const manifest=await loadManifest(root); const item=manifest.cases.find(c=>c.case_id===caseId);if(!item)throw new Error(`unknown synthetic case ${caseId}`);
 const base=path.join(root,"datasets/demo-v1",item.directory); const [data,network,snapshots,history]=await Promise.all([jsonl(path.join(base,"data-layer.jsonl")),jsonl(path.join(base,"network-events.jsonl")),jsonl(path.join(base,"platform-snapshots.jsonl")),readFile(path.join(base,"container-history.json"),"utf8")]);
 const visitor=before(data,"occurred_at",decisionTime), deliveries=before(network,"dispatched_at",decisionTime), availableSnapshots=before(snapshots,"observed_at",decisionTime);
 const count=(rows:Json[], key:string, value:string)=>rows.filter(r=>r[key]===value).length;
 return {provenance:{source:"synthetic-gtm-lab",datasetSchema:manifest.schema_version,lineageGroup:manifest.lineage_group,caseId,decisionTime,synthetic:true},facts:{visitorEvents:visitor.length,networkDeliveries:deliveries.length,purchases:{site:count(visitor,"event_name","purchase"),browser:deliveries.filter(r=>r.event_name==="purchase"&&r.source==="browser").length,server:deliveries.filter(r=>r.event_name==="purchase"&&r.source==="server").length},availablePlatformSnapshots:availableSnapshots.map(s=>({platform:s.platform,observedAt:s.observed_at,eventWindow:s.event_window})),containerHistory:JSON.parse(history)},cautions:["oracle labels and report-arrival schedule were not read","facts are filtered to decision time","ratio changes alone do not establish container causality","normalized platform snapshots are not passed to eval_gtm_signal_quality without an explicit mapping"]};
}

export async function buildSyntheticReplayRows(root:string, decisionTime:string):Promise<import("./jev-offline.js").DatasetRow[]>{
 const manifest=await loadManifest(root); return Promise.all(manifest.cases.map(async item=>{const observation=await observeSyntheticCase(root,item.case_id,decisionTime);return {input:{observation},prediction:{status:"unavailable" as const,reason:"synthetic lab has no live judge"},provenance:{containerGroup:manifest.lineage_group,lineageGroup:manifest.lineage_group,synthetic:true,samplingReasons:["synthetic-lab","seeded-audit"]}};}));
}
