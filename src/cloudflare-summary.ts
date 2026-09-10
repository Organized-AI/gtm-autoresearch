import {createHash} from 'node:crypto';
import {assertExportTarget,type Target} from './target.ts';
import {compare,ENGINE} from './connected.ts';
export const summarySchema=`CREATE TABLE IF NOT EXISTS gtm_qa_summaries (client_id TEXT NOT NULL, account_id TEXT NOT NULL, container_id TEXT NOT NULL, run_id TEXT NOT NULL, summary_json TEXT NOT NULL CHECK(json_valid(summary_json)), sha256 TEXT NOT NULL, PRIMARY KEY(client_id,account_id,container_id,run_id)); CREATE TRIGGER IF NOT EXISTS gtm_qa_summaries_immutable BEFORE UPDATE ON gtm_qa_summaries BEGIN SELECT RAISE(ABORT,'Save a new run instead of modifying evidence'); END;`;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const quote=(s:string)=>"'"+s.replace(/'/g,"''")+"'";
export function summaryPlan(target:Target,runId:string,original:unknown,candidate:unknown){
 for(const id of [target.clientId,target.accountId,target.containerId,runId])if(typeof id!=='string'||!id.trim()||id.length>160)throw Error('Invalid identity');
 assertExportTarget(target,original);assertExportTarget(target,candidate);
 const c=compare(original,candidate);
 const summary={schema:1,scope:'QA summary only; no restorable container export',target,runId,engine:ENGINE,status:c.status,before:c.before.combinedScore,after:c.after.combinedScore,dimensions:c.before.dimensions.map(d=>({name:d.name,before:d.score,after:c.after.dimensions.find(a=>a.name===d.name)?.score})),findings:c.after.issues,originalSha256:hash(JSON.stringify(original)),candidateSha256:hash(JSON.stringify(candidate))};
 const json=JSON.stringify(summary);if(Buffer.byteLength(json)>12000)throw Error('Summary exceeds 12 KB; narrow the run before saving');
 const sha256=hash(json);const ids=[target.clientId,target.accountId,target.containerId,runId];
 const where=['client_id','account_id','container_id','run_id'].map((k,i)=>k+'='+quote(ids[i])).join(' AND ');
 return {summary,json,sha256,setupSql:summarySchema,writeSql:`INSERT INTO gtm_qa_summaries VALUES (${[...ids,json,sha256].map(quote).join(',')}) ON CONFLICT(client_id,account_id,container_id,run_id) DO NOTHING;`,readSql:`SELECT client_id,account_id,container_id,run_id,summary_json,sha256 FROM gtm_qa_summaries WHERE ${where};`};
}
export function verifySummary(plan:ReturnType<typeof summaryPlan>,rows:any[]){
 if(rows.length!==1)throw Error('Expected exactly one saved record');const r=rows[0],t=plan.summary.target;
 if(r.client_id!==t.clientId||r.account_id!==t.accountId||r.container_id!==t.containerId||r.run_id!==plan.summary.runId)throw Error('Readback identity mismatch');
 if(typeof r.summary_json!=='string'||r.summary_json!==plan.json||hash(r.summary_json)!==plan.sha256||r.sha256!==plan.sha256)throw Error('Readback content mismatch');
 return {verified:true,runId:plan.summary.runId,sha256:plan.sha256,scope:plan.summary.scope};
}
