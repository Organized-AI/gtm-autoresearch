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
  frozen: Omit<FrozenDefinition, "content">; createdAt: string; truncation: string[];
}
export type JudgeResult =
 | { status: "success"; evidenceHash: string; definitionHash: string; requestedModel: string; reportedModel?: string; answers: { evidenceSufficient: AtomicAnswer; purchaseBehaviorPreserved: AtomicAnswer }; uncertainty?: number; latencyMs?: number; providerCostUsd?: number }
 | { status: "unavailable" | "error"; reason: string; evidenceHash?: string; definitionHash?: string };
export interface ShadowOutcome { mode: ShadowMode; actualAction: "improved" | "reverted" | "validation_fail" | "json_fail"; proposedRoute?: ProposedRoute; reasonCodes: string[]; judgment?: JudgeResult; disagreement?: boolean; }

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as RecordValue).sort().map(k => `${JSON.stringify(k)}:${stableJson((value as RecordValue)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function hash(value: unknown): string { return createHash("sha256").update(stableJson(value)).digest("hex"); }
export function freezeSeedDefinition(content = "evidence sufficiency and purchase behavior preservation"): FrozenDefinition {
  return { id: SEED_DEFINITION_ID, content, contentHash: hash(content), preprocessingVersion: "compact-evidence-v1", backend: "jev_align.AIFunction", requestedModel: "unconfigured", policyVersion: POLICY_VERSION, status: "seed" };
}
function byId(items: Array<RecordValue> | undefined, id: string): Map<string, RecordValue> { return new Map((items ?? []).map(x => [String(x[id]), x])); }
function diffCollection(before: Array<RecordValue> | undefined, after: Array<RecordValue> | undefined, id: string) { const a=byId(before,id), b=byId(after,id); return { added:[...b.keys()].filter(k=>!a.has(k)).sort(), removed:[...a.keys()].filter(k=>!b.has(k)).sort(), changed:[...a.keys()].filter(k=>b.has(k)&&stableJson(a.get(k))!==stableJson(b.get(k))).sort() }; }
function dimensions(scores: GtmSignalQualityResult): Record<string, number> { return Object.fromEntries(scores.dimensions.map(d=>[d.name,d.score])); }
export function buildEvidence(input: { runId?: string; parentId: string; candidateId?: string; baseline: GtmContainer; candidate: GtmContainer; operations: MutationOp[]; targetedIssue: string; before: GtmSignalQualityResult; after: GtmSignalQualityResult; validation: ValidationResult; snapshot?: { identity?: string; freshness?: "fresh"|"stale"; partial?: boolean }; qa?: CandidateEvidence["qa"]; frozen?: FrozenDefinition }): CandidateEvidence {
 const frozen=input.frozen ?? freezeSeedDefinition(); const cv=input.baseline.containerVersion, nv=input.candidate.containerVersion;
 return { schemaVersion:EVIDENCE_SCHEMA_VERSION,runId:input.runId??randomUUID(),candidateId:input.candidateId??hash(input.candidate).slice(0,16),parentId:input.parentId,baselineHash:hash(input.baseline),candidateHash:hash(input.candidate),operations:structuredClone(input.operations),targetedIssue:input.targetedIssue,entityDiff:{tag:diffCollection(cv.tag as RecordValue[]|undefined,nv.tag as RecordValue[]|undefined,"tagId"),trigger:diffCollection(cv.trigger as RecordValue[]|undefined,nv.trigger as RecordValue[]|undefined,"triggerId"),variable:diffCollection(cv.variable as RecordValue[]|undefined,nv.variable as RecordValue[]|undefined,"variableId"),folder:diffCollection(cv.folder as RecordValue[]|undefined,nv.folder as RecordValue[]|undefined,"folderId")},before:{score:input.before.combinedScore,dimensions:dimensions(input.before)},after:{score:input.after.combinedScore,dimensions:dimensions(input.after)},validation:{valid:input.validation.valid,reason:input.validation.reason},snapshot:{identity:input.snapshot?.identity??"none",freshness:input.snapshot?.freshness??"unknown",partial:input.snapshot?.partial??false},qa:input.qa??{status:"absent"},frozen:{id:frozen.id,contentHash:frozen.contentHash,preprocessingVersion:frozen.preprocessingVersion,backend:frozen.backend,requestedModel:frozen.requestedModel,policyVersion:frozen.policyVersion,status:frozen.status},createdAt:new Date().toISOString(),truncation:["full GTM exports retained separately; scripts/source text excluded from judge input"] };
}
export function compactJudgeInput(e: CandidateEvidence): RecordValue { return { schemaVersion:e.schemaVersion,runId:e.runId,candidateId:e.candidateId,parentId:e.parentId,evidenceHash:hash(e),operations:e.operations,targetedIssue:e.targetedIssue,entityDiff:e.entityDiff,before:e.before,after:e.after,validation:e.validation,snapshot:e.snapshot,qa:e.qa,frozen:e.frozen }; }
export async function writeEvidence(dir: string, evidence: CandidateEvidence, baseline: GtmContainer, candidate: GtmContainer): Promise<void> { await mkdir(dir,{recursive:true}); await Promise.all([writeFile(path.join(dir,"evidence.json"),JSON.stringify(evidence,null,2)),writeFile(path.join(dir,"baseline.json"),JSON.stringify(baseline,null,2)),writeFile(path.join(dir,"candidate.json"),JSON.stringify(candidate,null,2))]); }
export function validateJudgeResult(raw: unknown, evidence: CandidateEvidence): JudgeResult {
 if (!raw || typeof raw!=="object") return {status:"error",reason:"worker output is not an object"}; const r=raw as RecordValue;
 if (r.status!=="success") { const status=r.status==="unavailable"?"unavailable":"error"; return {status,reason:typeof r.reason==="string"?r.reason:"worker failure",evidenceHash:typeof r.evidenceHash==="string"?r.evidenceHash:undefined,definitionHash:typeof r.definitionHash==="string"?r.definitionHash:undefined}; }
 if(r.evidenceHash!==hash(evidence)||r.definitionHash!==evidence.frozen.contentHash||r.requestedModel!==evidence.frozen.requestedModel) return {status:"error",reason:"worker identity mismatch"};
 const answers=r.answers as RecordValue|undefined; const answer=(x:unknown): x is AtomicAnswer => x==="pass"||x==="fail"||x==="insufficient";
 if(!answers||!answer(answers.evidenceSufficient)||!answer(answers.purchaseBehaviorPreserved)) return {status:"error",reason:"invalid atomic answers"};
 for(const key of ["uncertainty","latencyMs","providerCostUsd"]){const v=r[key]; if(v!==undefined&&(!Number.isFinite(v)||Number(v)<0||(key==="uncertainty"&&Number(v)>1))) return {status:"error",reason:`invalid ${key}`};}
 return {status:"success",evidenceHash:r.evidenceHash as string,definitionHash:r.definitionHash as string,requestedModel:r.requestedModel as string,reportedModel:typeof r.reportedModel==="string"?r.reportedModel:undefined,answers:{evidenceSufficient:answers.evidenceSufficient,purchaseBehaviorPreserved:answers.purchaseBehaviorPreserved},uncertainty:r.uncertainty as number|undefined,latencyMs:r.latencyMs as number|undefined,providerCostUsd:r.providerCostUsd as number|undefined};
}
export function shadowPolicy(e: CandidateEvidence, j: JudgeResult): { route: ProposedRoute; reasonCodes: string[] } { if(!e.validation.valid)return{route:"revert",reasonCodes:["deterministic_validation_failed"]}; if(e.qa.status!=="passed")return{route:"review",reasonCodes:[`qa_${e.qa.status}`]}; if(j.status!=="success")return{route:"review",reasonCodes:[`judge_${j.status}`]}; if(j.answers.evidenceSufficient!=="pass")return{route:"review",reasonCodes:["insufficient_evidence"]}; if(j.answers.purchaseBehaviorPreserved!=="pass")return{route:"review",reasonCodes:["purchase_behavior_not_demonstrated"]}; if(e.after.score<=e.before.score)return{route:"revert",reasonCodes:["no_score_improvement"]}; return {route:"keep",reasonCodes:["positive_seed_rubric","score_improved"]}; }
export interface Judge { judge(evidence: CandidateEvidence): Promise<JudgeResult>; }
export class FakeJudge implements Judge { constructor(private readonly result: Partial<JudgeResult>={}) {} async judge(e: CandidateEvidence): Promise<JudgeResult> { return validateJudgeResult({status:"success",evidenceHash:hash(e),definitionHash:e.frozen.contentHash,requestedModel:e.frozen.requestedModel,answers:{evidenceSufficient:"pass",purchaseBehaviorPreserved:"pass"},...this.result},e); } }
export class PythonJevJudge implements Judge { constructor(private readonly python: string, private readonly worker: string, private readonly definitionPath: string, private readonly timeoutMs=10_000, private readonly maxOutput=128_000) {} async judge(evidence: CandidateEvidence): Promise<JudgeResult> { const input=JSON.stringify({protocol:"jev-shadow-v1",definitionPath:this.definitionPath,evidence:compactJudgeInput(evidence)}); const output=await new Promise<{code:number|null;out:string;err:string}>((resolve)=>{const child=spawn(this.python,[this.worker,"--protocol","jev-shadow-v1"],{stdio:["pipe","pipe","pipe"],shell:false}); let out="",err=""; const timer=setTimeout(()=>child.kill("SIGTERM"),this.timeoutMs); child.stdout.on("data",d=>{out+=String(d);if(out.length>this.maxOutput)child.kill("SIGTERM")}); child.stderr.on("data",d=>{err+=String(d).slice(0,4096)}); child.on("close",code=>{clearTimeout(timer);resolve({code,out,err})}); child.stdin.end(input);}); if(output.code!==0)return{status:"unavailable",reason:`worker exit ${output.code}: ${output.err.slice(0,240)}`}; try{return validateJudgeResult(JSON.parse(output.out),evidence)}catch{return{status:"error",reason:"malformed worker JSON"};} } }
