import { createHash } from "node:crypto";
import type { CandidateEvidence, JudgeResult, ProposedRoute } from "./jev-shadow.js";
export interface ReviewLabel { evidenceHash: string; trackingBehaviorPreserved: "pass"|"fail"; reviewer: string; reviewedAt: string; }
export interface DatasetRow { input: Record<string, unknown>; prediction: JudgeResult; provenance: { containerGroup: string; lineageGroup: string; topologyGroup?: string; baselineGroup?: string; plannedSplit?: "train"|"validation"|"holdout"; synthetic: boolean; samplingReasons: string[] }; label?: ReviewLabel; }
export function groupId(e: CandidateEvidence): string { return createHash("sha256").update(`${e.parentId}:${e.baselineHash}`).digest("hex").slice(0,16); }
export function exportJsonl(rows: DatasetRow[]): string { return rows.map(row=>JSON.stringify(row)).join("\n")+"\n"; }
export function samplingManifest(rows: DatasetRow[]): Array<{ evidenceHash:string; reasons:string[]; group:string }> { return rows.map(row=>({evidenceHash:(row.input.evidenceHash as string),reasons:row.provenance.samplingReasons,group:row.provenance.containerGroup})); }
export function splitByGroup(rows: DatasetRow[], seed="jev-shadow-v1"): { train: DatasetRow[]; validation: DatasetRow[]; holdout: DatasetRow[] } {
 const allPlanned=rows.map(row=>row.provenance.plannedSplit);
 if(allPlanned.some(value=>value!==undefined)&&allPlanned.some(value=>value===undefined))throw new Error("conflicting or incomplete declared split component");
 const parent=rows.map((_,i)=>i);
 const find=(i:number):number=>parent[i]===i?i:(parent[i]=find(parent[i]));
 const join=(a:number,b:number)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a};
 const dimensions: Array<(row: DatasetRow) => string | undefined> = [
   row => row.provenance.containerGroup,
   row => row.provenance.lineageGroup,
   row => row.provenance.topologyGroup,
   row => row.provenance.baselineGroup,
 ];
 for (const getKey of dimensions) {
   const seen = new Map<string, number>();
   rows.forEach((row,index)=>{
     const key=getKey(row);
     if(!key)return;
     const prior=seen.get(key);
     if(prior===undefined)seen.set(key,index); else join(index,prior);
   });
 }
 const groups=new Map<number,DatasetRow[]>();
 rows.forEach((row,index)=>{
   const root=find(index);
   groups.set(root,[...(groups.get(root)??[]),row]);
 });
 const buckets={train:[] as DatasetRow[],validation:[] as DatasetRow[],holdout:[] as DatasetRow[]};
 for(const items of groups.values()){
   const declared=items.map(item=>item.provenance.plannedSplit);
   const declaredValues=new Set(declared.filter((value): value is "train"|"validation"|"holdout"=>value!==undefined));
   const hasDeclared=declaredValues.size>0;
   if(hasDeclared&&(declaredValues.size!==1||declared.some(value=>value===undefined)))throw new Error("conflicting or incomplete declared split component");
   const identity=[...new Set(items.flatMap(item=>[
     JSON.stringify(["container",item.provenance.containerGroup]),
     JSON.stringify(["lineage",item.provenance.lineageGroup]),
     item.provenance.topologyGroup?JSON.stringify(["topology",item.provenance.topologyGroup]):null,
     item.provenance.baselineGroup?JSON.stringify(["baseline",item.provenance.baselineGroup]):null,
   ].filter(Boolean) as string[]))].sort().join("|");
   const digest=createHash("sha256").update(seed+identity).digest()[0]%10;
   const bucket=hasDeclared?[...declaredValues][0]:digest<6?"train":digest<8?"validation":"holdout";
   buckets[bucket].push(...items);
 }
 return buckets;
}
export function assertGroupDisjoint(split: ReturnType<typeof splitByGroup>): void { const dimensions=["containerGroup","lineageGroup","topologyGroup","baselineGroup"] as const;for(const dimension of dimensions){const sets=Object.values(split).map(rows=>new Set(rows.map(r=>r.provenance[dimension]).filter(Boolean)));for(let i=0;i<sets.length;i++)for(let j=i+1;j<sets.length;j++)for(const key of sets[i])if(sets[j].has(key))throw new Error(`${dimension} leakage: ${key}`)}}
export function replayReport(rows: Array<DatasetRow & { route: ProposedRoute; latencyMs?:number }>): Record<string, unknown> { const labeled=rows.filter(r=>r.label); const count=(predicate:(r:typeof rows[number])=>boolean)=>rows.filter(predicate).length; const harmfulApproved=count(r=>r.route==="keep"&&r.label?.trackingBehaviorPreserved==="fail"); const validRejected=count(r=>r.route==="revert"&&r.label?.trackingBehaviorPreserved==="pass"); return { denominator:rows.length,labeledDenominator:labeled.length,proposedKeeps:count(r=>r.route==="keep"),reviewRate:rows.length?count(r=>r.route==="review")/rows.length:null,harmfulChangeApprovalRate:count(r=>r.label?.trackingBehaviorPreserved==="fail")?harmfulApproved/count(r=>r.label?.trackingBehaviorPreserved==="fail"):null,harmAmongProposedKeeps:count(r=>r.route==="keep"&&!!r.label)?harmfulApproved/count(r=>r.route==="keep"&&!!r.label):null,validFixRejectionRate:count(r=>r.label?.trackingBehaviorPreserved==="pass")?validRejected/count(r=>r.label?.trackingBehaviorPreserved==="pass"):null,latencyMs:rows.some(r=>r.latencyMs!==undefined)?rows.reduce((n,r)=>n+(r.latencyMs??0),0)/rows.length:null,providerCostUsd:"unavailable without provider telemetry",confusion:{harmfulApproved,validRejected,unreviewed:rows.length-labeled.length} }; }
