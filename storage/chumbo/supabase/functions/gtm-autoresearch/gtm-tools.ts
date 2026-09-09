import {errorResult,structuredResult,type SupabaseMcpContext,type SupabaseMcpServer} from 'chumbo';
import {z} from 'zod';
import {digest,validateRecord,key} from './archive.ts';
import {evaluate,compare,parseContainer,parseSnapshot,ENGINE} from './engine/connected.ts';
import {ENGINE_DIGEST} from './engine/version.ts';
const id=z.string().regex(/^[a-f0-9]{64}$/);
const URI='ui://organized-ai/gtm-autoresearch-history.html';
const meta={ui:{resourceUri:URI,visibility:['model','app']},'ui/resourceUri':URI};
type Ctx=SupabaseMcpContext<any>;
const bounds='Heuristic ecommerce-oriented configuration checks on supplied JSON. Does not verify live firing, platform data authenticity, or business outcomes. Review never applies or publishes a container.';
export async function inspectEvidence(p:any){
 if(p.engine!==ENGINE||p.engineDigest!==ENGINE_DIGEST)return {status:'historical-engine',reason:'This record uses another engine version. Its reported score is historical; no current-score claim is made.'};
 try{
  if(await digest(p.container)!==p.containerHash||await digest(p.snapshot??null)!==p.snapshotHash)throw Error('Input identity mismatch');
  const result=evaluate(p.container,p.snapshot);
  const comparison=p.original?compare(p.original,p.container,p.snapshot):null;
  return {status:'recomputed-gtm-evidence',result,comparison,scope:bounds,engineDigest:ENGINE_DIGEST};
 }catch{return {status:'invalid-evidence',reason:'Stored GTM inputs failed validation; no verified score is available.'};}
}
async function owned(ctx:Ctx,recordId:string){const {data,error}=await ctx.supabase.from('skill_loop_history').select('document,record_hash').eq('record_hash',recordId).maybeSingle();if(error||!data)throw Error('Baseline not found for this account');await validateRecord({id:data.record_hash,document:data.document});return data.document;}
async function save(ctx:Ctx,project:string,skillId:string,kind:'run'|'proposal',payload:any){
 const now=new Date().toISOString();const document={version:1,project,skillId,kind,occurredAt:now,mode:'evidence',payload:{...payload,engine:ENGINE,engineDigest:ENGINE_DIGEST,createdAt:now,scope:bounds}};
 const record={id:await digest(document),document};await validateRecord(record);
 const {error}=await ctx.supabase.from('skill_loop_history').insert({record_hash:record.id,project,skill_id:skillId,kind,document,summary:{score:payload.result.combinedScore*100,status:payload.comparison?.status??'baseline',runner:ENGINE,conditions:payload.snapshotHash}});
 if(error)throw Error('GTM evidence could not be saved');return record.id;
}
export function registerGtmTools(server:SupabaseMcpServer,ctx:Ctx,detail:(ctx:Ctx,id:string)=>Promise<unknown>){
 const protect=(fn:(args:any)=>Promise<unknown>)=>async(args:any)=>{try{return structuredResult(await fn(args));}catch(e){return errorResult(e instanceof Error?e.message:'GTM evaluation failed','No live GTM changes were made. Correct the supplied inputs or reopen your saved baseline.');}};
 server.withScopes(['history:write']).registerTool('evaluate_gtm_container',{title:'Check a GTM container',description:'Score and privately save a complete supplied GTM export with the original Autoresearch evaluator. Requires explicit tag, trigger, variable, folder and builtInVariable arrays. Optionally include an enriched ads snapshot. No model call or GTM account access. Stores the supplied JSON in this user’s private history.',inputSchema:z.object({project:key,containerName:key,container:z.record(z.string(),z.unknown()),snapshot:z.record(z.string(),z.unknown()).optional()}),_meta:meta},protect(async args=>{
  const container=parseContainer(args.container),snapshot=parseSnapshot(args.snapshot),result=evaluate(container,snapshot);
  const recordId=await save(ctx,args.project,args.containerName,'run',{container,snapshot:snapshot??null,result,containerHash:await digest(container),snapshotHash:await digest(snapshot??null)});
  return detail(ctx,recordId);
 }));
 server.withScopes(['history:write']).registerTool('compare_gtm_candidate',{title:'Test a proposed GTM revision',description:'Load this account’s stored baseline, rescore it and the supplied complete candidate under exactly the same saved ads snapshot. Save side-by-side evidence. A higher score with no new errors or dimension regressions may be eligible for human review; nothing is applied or published. Claude can propose another candidate based on this result.',inputSchema:z.object({baselineId:id,candidate:z.record(z.string(),z.unknown())}),_meta:meta},protect(async args=>{
  const baseline=await owned(ctx,args.baselineId),p=baseline.payload;
  if(p.engine!==ENGINE||p.engineDigest!==ENGINE_DIGEST)throw Error('Baseline engine changed; create a fresh baseline');
  const checked=await inspectEvidence(p);if(checked.status!=='recomputed-gtm-evidence')throw Error('Baseline evidence is invalid');
  if('comparison' in checked&&checked.comparison&&!checked.comparison.eligible)throw Error('A rejected or unchanged proposal cannot become a baseline');
  const candidate=parseContainer(args.candidate),comparison=compare(p.container,candidate,p.snapshot);
  const recordId=await save(ctx,baseline.project,baseline.skillId,'proposal',{container:candidate,original:p.container,snapshot:p.snapshot??null,result:comparison.after,comparison,parentId:args.baselineId,containerHash:await digest(candidate),snapshotHash:p.snapshotHash});
  return detail(ctx,recordId);
 }));
}
