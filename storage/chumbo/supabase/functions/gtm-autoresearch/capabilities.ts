import {errorResult,structuredResult,type SupabaseMcpContext,type SupabaseMcpServer} from 'chumbo';
import {z} from 'zod';
import {recordSchema,querySchema,validateRecord} from './archive.ts';
import {registerGtmTools, inspectEvidence} from './gtm-tools.ts';
const URI='ui://organized-ai/gtm-autoresearch-history.html';
const meta=(visibility:('model'|'app')[])=>({ui:{resourceUri:URI,visibility},'ui/resourceUri':URI});
type Ctx=SupabaseMcpContext<any>;
const hashSchema=z.string().regex(/^[a-f0-9]{64}$/);
export function summary(payload:Record<string,unknown>){return Object.fromEntries(['id','createdAt','kind','runner','skillHash','packageHash','passed','total','score','conditions','status'].filter(k=>typeof payload[k]==='number'||typeof payload[k]==='boolean'||(typeof payload[k]==='string'&&(payload[k] as string).length<=160)).map(k=>[k,payload[k]]));}
export async function list(ctx:Ctx,args:z.infer<typeof querySchema>){
 const {data,error}=await ctx.supabase.from('skill_loop_history').select('sequence,record_hash,project,skill_id,kind,saved_at,summary').eq('project',args.project).eq('skill_id',args.skillId).gt('sequence',args.after).order('sequence').limit(21);
 if(error)throw Error('History could not be read');
 const rows=(data??[]).slice(0,20);return {project:args.project,skillId:args.skillId,events:rows,next:(data??[]).length>20?rows.at(-1)?.sequence:null};
}
export async function detail(ctx:Ctx,id:string){
 const {data,error}=await ctx.supabase.from('skill_loop_history').select('sequence,record_hash,document,saved_at').eq('record_hash',id).maybeSingle();
 if(error||!data)throw Error('History record not found for this account');
 await validateRecord({id:data.record_hash,document:data.document});
 const qa=await inspectEvidence(data.document.payload);
 const {data:findings,error:fe}=await ctx.supabase.from('skill_loop_findings').select('id,record_hash,finding_key,finding,status,note,revision,updated_at').eq('record_hash',id).order('id').limit(101);
 if(fe)throw Error('Review findings could not be read');
 if((findings??[]).length>100)throw Error('This record exceeds the review UI limit of 100 findings');
 return {record:{sequence:data.sequence,id:data.record_hash,document:data.document,savedAt:data.saved_at},qa,findings:findings??[]};
}
export function registerCapabilities(server:SupabaseMcpServer,ctx:Ctx){
 const protect=<A>(fn:(args:A)=>Promise<unknown>)=>async(args:A)=>{try{return structuredResult(await fn(args));}catch(e){return errorResult(e instanceof Error?e.message:'Operation failed','Refresh saved evidence before retrying. No GTM container was changed.');}};
 registerGtmTools(server,ctx,detail);
 for(const [name,visibility] of [['list_skill_history',['model']],['open_skill_history',['model']],['refresh_skill_history',['app']]] as const){
  server.withScopes(['history:read']).registerTool(name,{title:'GTM Autoresearch saved history',description:'List this account’s saved GTM history. Open the interactive history to inspect runs and review findings.',inputSchema:querySchema,annotations:{readOnlyHint:true},...(name==='list_skill_history'?{}:{_meta:meta([...visibility])})},protect(args=>list(ctx,args)));
 }
 server.withScopes(['history:read']).registerTool('get_history_record',{title:'Inspect GTM evidence',description:'Read a private record and rescore stored GTM evidence without running a model. Also returns findings.',inputSchema:z.object({id:hashSchema}),annotations:{readOnlyHint:true},_meta:meta(['model','app'])},protect(args=>detail(ctx,args.id)));
 server.withScopes(['history:write']).registerTool('add_review_finding',{title:'Record a QA finding',description:'Add a prose-review finding tied to exact saved evidence. Repeating the same key and text is safe. Does not alter evaluator scores.',inputSchema:z.object({recordId:hashSchema,key:z.string().min(1).max(120),finding:z.string().trim().min(1).max(4000)}),annotations:{idempotentHint:true}},protect(async args=>{
  const {data,error}=await ctx.supabase.rpc('skill_loop_add_finding',{p_record_hash:args.recordId,p_key:args.key,p_finding:args.finding});if(error)throw Error('Finding could not be added; verify the record and use a unique finding key');return data;
 }));
 server.withScopes(['review:decide']).registerTool('decide_review_finding',{title:'Accept, dismiss or reopen finding',description:'Save a review decision with a version precondition. Accepting a finding requests a fix; it does not approve or apply a GTM revision.',inputSchema:z.object({id:z.string().uuid(),revision:z.number().int().nonnegative(),status:z.enum(['accepted','dismissed','pending']),note:z.string().trim().max(4000)}),annotations:{idempotentHint:false},_meta:meta(['app'])},protect(async args=>{
  if(args.status==='dismissed'&&!args.note)throw Error('Add a reason before dismissing a finding');
  const {data,error}=await ctx.supabase.rpc('skill_loop_decide_finding',{p_id:args.id,p_revision:args.revision,p_status:args.status,p_note:args.note});if(error)throw Error('Review changed or is unavailable; refresh before deciding');return await detail(ctx,data.record_hash);
 }));
 server.withScopes(['history:read']).registerTool('list_review_history',{title:'Review decision history',description:'Read this account’s audit trail for a finding, including reopened decisions.',inputSchema:z.object({findingId:z.string().uuid(),after:z.number().int().nonnegative().default(0)}),annotations:{readOnlyHint:true}},protect(async args=>{
  const {data,error}=await ctx.supabase.from('skill_loop_review_events').select('id,finding_id,revision,status,note,created_at').eq('finding_id',args.findingId).gt('id',args.after).order('id').limit(101);if(error)throw Error('Review history unavailable');return {events:(data??[]).slice(0,100),next:(data??[]).length>100?data[99].id:null};
 }));
 server.withScopes(['history:read']).registerResource('gtm-autoresearch-history-app',URI,{mimeType:'text/html;profile=mcp-app',title:'GTM Autoresearch · Organized AI'},async uri=>({contents:[{uri:uri.href,mimeType:'text/html;profile=mcp-app',text:await Deno.readTextFile(new URL('./dist/index.html',import.meta.url)),_meta:{ui:{csp:{},prefersBorder:true}}}]}));
}
