/** Shadow-only semantic judging. Deterministic GTM validation remains authoritative. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import type { GtmContainer, GtmSignalQualityResult } from "../evals/eval_gtm_signal_quality.js";
import type { MutationOp, ValidationResult } from "./gtm-container-mutations.js";

export const EVIDENCE_SCHEMA_VERSION = "gtm-jev-evidence-v1";
export const POLICY_VERSION = "purchase-shadow-policy-v1";
export const SEED_DEFINITION_ID = "purchase-behavior-seed-v1";
export type QaStatus = "passed" | "failed" | "absent";
export type AtomicAnswer = "pass" | "fail" | "insufficient";
export type ProposedRoute = "keep" | "review" | "revert";
export type ShadowMode = "off" | "shadow";
type RecordValue = Record<string, unknown>;

export interface FrozenDefinition {
  id: string; content: string; contentHash: string; preprocessingVersion: string;
  backend: string; requestedModel: string; policyVersion: string; status: "seed" | "accepted";
}
export interface CandidateEvidence {
  schemaVersion: string; runId: string; candidateId: string; parentId: string;
  baselineHash: string; candidateHash: string; operations: MutationOp[]; targetedIssue: string;
  entityDiff: Record<string, { added: string[]; removed: string[]; changed: string[] }>;
  before: { score: number; dimensions: Record<string, number> };
  after: { score: number; dimensions: Record<string, number> };
  validation: { valid: boolean; reason: string }; snapshot: { identity: string; freshness: "unknown" | "fresh" | "stale"; partial: boolean };
  qa: { status: QaStatus; source?: string; capturedAt?: string; detail?: string };
  supportingEvidence?: RecordValue; entityContext: Record<string, Array<{ id: string; name?: string; type?: string; firingTriggerId?: unknown; parentFolderId?: unknown }>>;
  frozen: Omit<FrozenDefinition, "content">; createdAt: string; truncation: string[];
}
export type JudgeResult =
 | { status: "success"; evidenceHash: string; definitionHash: string; requestedModel: string; reportedModel?: string; answers: { evidenceSufficient: AtomicAnswer; trackingBehaviorPreserved: AtomicAnswer }; uncertainty?: number; latencyMs?: number; providerCostUsd?: number }
 | { status: "unavailable" | "error"; reason: string; evidenceHash?: string; definitionHash?: string };
export interface ShadowOutcome { mode: ShadowMode; actualAction: "improved" | "reverted" | "validation_fail" | "json_fail"; proposedRoute?: ProposedRoute; reasonCodes: string[]; judgment?: JudgeResult; disagreement?: boolean; }

export function stableJson(value: unknown): string {
  // Match JSON persistence: omit undefined object properties and encode undefined
  // array entries as null. This keeps evidence hashes stable after JSON round trips.
  if (Array.isArray(value)) return `[${value.map(item => item === undefined ? "null" : stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") { const record=value as RecordValue; return `{${Object.keys(record).filter(key=>record[key]!==undefined).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`; }
  return value === undefined ? "null" : JSON.stringify(value);
}
export function hash(value: unknown): string { return createHash("sha256").update(stableJson(value)).digest("hex"); }
export function freezeSeedDefinition(content = "evidence sufficiency and tracking behavior preservation"): FrozenDefinition {
  return { id: SEED_DEFINITION_ID, content, contentHash: hash(content), preprocessingVersion: "compact-evidence-v1", backend: "jev_align.AIFunction", requestedModel: "unconfigured", policyVersion: POLICY_VERSION, status: "seed" };
}
export function manifestHash(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("frozen manifest must be an object");
  const payload = structuredClone(raw as RecordValue); delete payload.manifestHash; return hash(payload);
}
export function frozenDefinitionFromManifest(raw: unknown): FrozenDefinition {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("frozen manifest must be an object");
  const value = raw as RecordValue; const required = ["manifestHash", "definitionHash", "requestedModel", "preprocessingVersion", "policyVersion"];
  if (required.some(key => typeof value[key] !== "string" || value[key] === "")) throw new Error("frozen manifest is missing required identity fields");
  if (value.manifestHash !== manifestHash(value)) throw new Error("frozen manifest content hash mismatch");
  const functions = value.functions as RecordValue | undefined;
  if (!functions || Object.keys(functions).sort().join(",") !== "evidenceSufficient,trackingBehaviorPreserved") throw new Error("frozen manifest is missing atomic functions");
  for (const spec of Object.values(functions)) if (!spec || typeof spec !== "object" || ["path","definitionHash","provider","model"].some(key => typeof (spec as RecordValue)[key] !== "string")) throw new Error("frozen manifest has invalid function identity");
  // A manifest freezes a seed snapshot; it never means human acceptance or calibration.
  return { id: "frozen-manifest-v1", content: `manifest:${value.manifestHash}`, contentHash: value.manifestHash as string, preprocessingVersion: value.preprocessingVersion as string, backend: "jev_align.AIFunction", requestedModel: value.requestedModel as string, policyVersion: value.policyVersion as string, status: "seed" };
}
function byId(items: Array<RecordValue> | undefined, id: string): Map<string, RecordValue> { return new Map((items ?? []).map(x => [String(x[id]), x])); }
function diffCollection(before: Array<RecordValue> | undefined, after: Array<RecordValue> | undefined, id: string) { const a=byId(before,id), b=byId(after,id); return { added:[...b.keys()].filter(k=>!a.has(k)).sort(), removed:[...a.keys()].filter(k=>!b.has(k)).sort(), changed:[...a.keys()].filter(k=>b.has(k)&&stableJson(a.get(k))!==stableJson(b.get(k))).sort() }; }
function dimensions(scores: GtmSignalQualityResult): Record<string, number> { return Object.fromEntries(scores.dimensions.map(d=>[d.name,d.score])); }
function context(items: Array<RecordValue> | undefined, changed: string[], id: string) { const map=byId(items,id); return changed.map(key=>{const item=map.get(key)??{};return {id:key,name:typeof item.name==="string"?item.name:undefined,type:typeof item.type==="string"?item.type:undefined,firingTriggerId:item.firingTriggerId,parentFolderId:item.parentFolderId};}); }
export function buildEvidence(input: { runId?: string; parentId: string; candidateId?: string; baseline: GtmContainer; candidate: GtmContainer; operations: MutationOp[]; targetedIssue: string; before: GtmSignalQualityResult; after: GtmSignalQualityResult; validation: ValidationResult; snapshot?: { identity?: string; freshness?: "fresh"|"stale"; partial?: boolean }; qa?: CandidateEvidence["qa"]; supportingEvidence?: RecordValue; frozen?: FrozenDefinition }): CandidateEvidence {
 const frozen=input.frozen ?? freezeSeedDefinition(); const cv=input.baseline.containerVersion, nv=input.candidate.containerVersion;
 const entityDiff={tag:diffCollection(cv.tag as RecordValue[]|undefined,nv.tag as RecordValue[]|undefined,"tagId"),trigger:diffCollection(cv.trigger as RecordValue[]|undefined,nv.trigger as RecordValue[]|undefined,"triggerId"),variable:diffCollection(cv.variable as RecordValue[]|undefined,nv.variable as RecordValue[]|undefined,"variableId"),folder:diffCollection(cv.folder as RecordValue[]|undefined,nv.folder as RecordValue[]|undefined,"folderId")}; return { schemaVersion:EVIDENCE_SCHEMA_VERSION,runId:input.runId??randomUUID(),candidateId:input.candidateId??hash(input.candidate).slice(0,16),parentId:input.parentId,baselineHash:hash(input.baseline),candidateHash:hash(input.candidate),operations:structuredClone(input.operations),targetedIssue:input.targetedIssue,entityDiff,entityContext:{tag:context(nv.tag as RecordValue[]|undefined,[...entityDiff.tag.added,...entityDiff.tag.changed],"tagId"),trigger:context(nv.trigger as RecordValue[]|undefined,[...entityDiff.trigger.added,...entityDiff.trigger.changed],"triggerId"),variable:context(nv.variable as RecordValue[]|undefined,[...entityDiff.variable.added,...entityDiff.variable.changed],"variableId"),folder:context(nv.folder as RecordValue[]|undefined,[...entityDiff.folder.added,...entityDiff.folder.changed],"folderId")},supportingEvidence:input.supportingEvidence,before:{score:input.before.combinedScore,dimensions:dimensions(input.before)},after:{score:input.after.combinedScore,dimensions:dimensions(input.after)},validation:{valid:input.validation.valid,reason:input.validation.reason},snapshot:{identity:input.snapshot?.identity??"none",freshness:input.snapshot?.freshness??"unknown",partial:input.snapshot?.partial??false},qa:input.qa??{status:"absent"},frozen:{id:frozen.id,contentHash:frozen.contentHash,preprocessingVersion:frozen.preprocessingVersion,backend:frozen.backend,requestedModel:frozen.requestedModel,policyVersion:frozen.policyVersion,status:frozen.status},createdAt:new Date().toISOString(),truncation:["full GTM exports retained separately; scripts/source text excluded from judge input"] };
}
export function compactJudgeInput(e: CandidateEvidence): RecordValue { return { schemaVersion:e.schemaVersion,runId:e.runId,candidateId:e.candidateId,parentId:e.parentId,evidenceHash:hash(e),operations:e.operations,targetedIssue:e.targetedIssue,entityDiff:e.entityDiff,entityContext:e.entityContext,supportingEvidence:e.supportingEvidence,before:e.before,after:e.after,validation:e.validation,snapshot:e.snapshot,qa:e.qa,frozen:e.frozen }; }
export async function writeEvidence(dir: string, evidence: CandidateEvidence, baseline: GtmContainer, candidate: GtmContainer): Promise<void> { await mkdir(dir,{recursive:true}); await Promise.all([writeFile(path.join(dir,"evidence.json"),JSON.stringify(evidence,null,2)),writeFile(path.join(dir,"baseline.json"),JSON.stringify(baseline,null,2)),writeFile(path.join(dir,"candidate.json"),JSON.stringify(candidate,null,2))]); }
export function validateJudgeResult(raw: unknown, evidence: CandidateEvidence): JudgeResult {
 if (!raw || typeof raw!=="object") return {status:"error",reason:"worker output is not an object"}; const r=raw as RecordValue;
 if (r.status!=="success") { const status=r.status==="unavailable"?"unavailable":"error"; return {status,reason:typeof r.reason==="string"?r.reason:"worker failure",evidenceHash:typeof r.evidenceHash==="string"?r.evidenceHash:undefined,definitionHash:typeof r.definitionHash==="string"?r.definitionHash:undefined}; }
 if(r.evidenceHash!==hash(evidence)||r.definitionHash!==evidence.frozen.contentHash||r.requestedModel!==evidence.frozen.requestedModel) return {status:"error",reason:"worker identity mismatch"};
 const answers=r.answers as RecordValue|undefined; const answer=(x:unknown): x is AtomicAnswer => x==="pass"||x==="fail"||x==="insufficient";
 if(!answers||!answer(answers.evidenceSufficient)||!answer(answers.trackingBehaviorPreserved)) return {status:"error",reason:"invalid atomic answers"};
 for(const key of ["uncertainty","latencyMs","providerCostUsd"]){const v=r[key]; if(v!==undefined&&(!Number.isFinite(v)||Number(v)<0||(key==="uncertainty"&&Number(v)>1))) return {status:"error",reason:`invalid ${key}`};}
 return {status:"success",evidenceHash:r.evidenceHash as string,definitionHash:r.definitionHash as string,requestedModel:r.requestedModel as string,reportedModel:typeof r.reportedModel==="string"?r.reportedModel:undefined,answers:{evidenceSufficient:answers.evidenceSufficient,trackingBehaviorPreserved:answers.trackingBehaviorPreserved},uncertainty:r.uncertainty as number|undefined,latencyMs:r.latencyMs as number|undefined,providerCostUsd:r.providerCostUsd as number|undefined};
}
export function shadowPolicy(e: CandidateEvidence, j: JudgeResult): { route: ProposedRoute; reasonCodes: string[] } { if(!e.validation.valid)return{route:"revert",reasonCodes:["deterministic_validation_failed"]}; if(e.qa.status!=="passed")return{route:"review",reasonCodes:[`qa_${e.qa.status}`]}; if(j.status!=="success")return{route:"review",reasonCodes:[`judge_${j.status}`]}; if(j.answers.evidenceSufficient!=="pass")return{route:"review",reasonCodes:["insufficient_evidence"]}; if(j.uncertainty===undefined)return{route:"review",reasonCodes:["uncertainty_missing"]}; if(e.frozen.status!=="accepted")return{route:"review",reasonCodes:["definition_uncalibrated"]}; if(j.answers.trackingBehaviorPreserved!=="pass")return{route:"review",reasonCodes:["tracking_behavior_not_demonstrated"]}; if(e.after.score<=e.before.score)return{route:"revert",reasonCodes:["no_score_improvement"]}; return {route:"keep",reasonCodes:["positive_seed_rubric","score_improved"]}; }
export interface Judge { judge(evidence: CandidateEvidence): Promise<JudgeResult>; }
export class FakeJudge implements Judge { constructor(private readonly result: Partial<JudgeResult>={}) {} async judge(e: CandidateEvidence): Promise<JudgeResult> { return validateJudgeResult({status:"success",evidenceHash:hash(e),definitionHash:e.frozen.contentHash,requestedModel:e.frozen.requestedModel,answers:{evidenceSufficient:"pass",trackingBehaviorPreserved:"pass"},uncertainty:0.1,...this.result},e); } }
export class PythonJevJudge implements Judge {
  constructor(private readonly python:string,private readonly worker:string,private readonly definitionPath:string,private readonly timeoutMs=10_000,private readonly maxOutput=128_000,private readonly environment:NodeJS.ProcessEnv={}) {}
  async judge(evidence:CandidateEvidence):Promise<JudgeResult>{
    const input=JSON.stringify({protocol:"jev-shadow-v1",definitionPath:this.definitionPath,evidence:compactJudgeInput(evidence)});
    const output=await new Promise<{code:number|null;out:string;failure?:string}>((resolve)=>{
      let settled=false,out="",failure:string|undefined,killTimer:NodeJS.Timeout|undefined;
      const child=spawn(this.python,[this.worker,"--protocol","jev-shadow-v1"],{
        stdio:["pipe","pipe","pipe"],shell:false,env:{...process.env,...this.environment},
      });
      const stop=(reason:string)=>{
        if(failure)return;
        failure=reason;
        child.kill("SIGTERM");
        killTimer=setTimeout(()=>child.kill("SIGKILL"),250);
      };
      const timer=setTimeout(()=>stop("worker timeout"),this.timeoutMs);
      const finish=(code:number|null)=>{
        if(settled)return;
        settled=true;clearTimeout(timer);if(killTimer)clearTimeout(killTimer);
        resolve({code,out,failure});
      };
      child.on("error",()=>{failure="worker process could not start";finish(null)});
      let outputBytes=0;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data",(data:string)=>{
        outputBytes+=Buffer.byteLength(data,"utf8");
        if(outputBytes>this.maxOutput){stop("worker output exceeded limit");return;}
        if(!failure)out+=data;
      });
      // Drain diagnostics without retaining provider output or credentials in evidence.
      child.stderr.on("data",()=>{});
      child.stdin.on("error",()=>stop("worker input failed"));
      child.on("close",finish);
      child.stdin.end(input);
    }).catch(()=>({code:null,out:"",failure:"worker process could not start"}));
    if(output.failure)return{status:"unavailable",reason:output.failure};
    if(output.code!==0)return{status:"unavailable",reason:`worker exit ${output.code}`};
    try{return validateJudgeResult(JSON.parse(output.out),evidence)}
    catch{return{status:"error",reason:"malformed worker JSON"};}
  }
}
