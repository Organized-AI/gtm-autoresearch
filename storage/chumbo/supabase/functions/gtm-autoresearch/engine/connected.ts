import { z } from 'zod';
import { evaluateGtmSignalQuality, type GtmContainer } from './evaluator.ts';
import { validateMutation } from './mutations.ts';
export const ENGINE = 'gtm-autoresearch-connected-v1';
const text = z.string().min(1).max(500);
const number = z.number().finite().nonnegative();
const parameter: z.ZodType<any> = z.lazy(() => z.object({type:text,key:text.optional(),value:z.string().optional(),list:z.array(parameter).max(500).optional(),map:z.array(parameter).max(500).optional()}).passthrough());
const params=z.array(parameter).max(500);
const filters=z.array(z.object({type:text,parameter:params.optional()}).passthrough()).max(500);
const entity={name:text,type:text,parameter:params.optional(),parentFolderId:text.optional()};
export const containerSchema=z.object({exportFormatVersion:z.number().int().positive(),containerVersion:z.object({
 tag:z.array(z.object({...entity,tagId:text,firingTriggerId:z.array(text).max(500).optional(),blockingTriggerId:z.array(text).max(500).optional(),consentSettings:z.object({consentStatus:text}).passthrough().optional(),setupTag:z.array(z.object({tagName:text}).passthrough()).optional(),teardownTag:z.array(z.object({tagName:text}).passthrough()).optional()}).passthrough()).max(1000),
 trigger:z.array(z.object({...entity,triggerId:text,customEventFilter:filters.optional(),filter:filters.optional(),autoEventFilter:filters.optional()}).passthrough()).max(1000),
 variable:z.array(z.object({...entity,variableId:text}).passthrough()).max(1000),
 folder:z.array(z.object({folderId:text,name:text}).passthrough()).max(1000),
 builtInVariable:z.array(z.object({type:text,name:text}).passthrough()).max(500),
}).passthrough()}).passthrough();
const event=z.object({event:text,count_7d_click:number,count_1d_click:number,count_1d_view:number,value_7d_click:number,count_browser:number.optional(),count_server:number.optional(),dedup_rate:number.max(1).optional(),emq_score:number.max(10).optional()}).passthrough();
export const snapshotSchema=z.object({generated_at:z.string().datetime({offset:true}),partial:z.literal(false).optional(),meta:z.object({account_id:text,account_name:text,pixel_id:text,currency:text,spend:number,date_range:z.object({since:text,until:text}),conversion_events:z.array(event).max(1000)}).optional(),google_ads:z.object({customer_id:text,customer_name:text,currency:text,conversion_actions:z.array(z.object({id:text,name:text,category:text,status:z.enum(['ENABLED','REMOVED','HIDDEN']),counting_type:text,click_through_lookback_window_days:number,conversion_count_30d:number,conversion_value_30d:number,tag_snippets:z.array(z.string()).max(100)})).max(1000)}).optional(),funnel:z.array(z.object({from_event:text,to_event:text,ratio:number,expected_low:number,expected_high:number,status:z.enum(['normal','low','high'])})).max(1000)});
export type Snapshot=z.infer<typeof snapshotSchema>;
export function bounded(value:unknown){
 const raw=JSON.stringify(value);if(!raw||new TextEncoder().encode(raw).length>250000)throw Error('Input exceeds 250 KB; use a smaller complete export');
 function visit(v:any,depth:number){if(depth>30)throw Error('Input nesting exceeds 30 levels');if(typeof v==='number'&&!Number.isFinite(v))throw Error('Nonfinite number');if(v&&typeof v==='object'){for(const [k,x]of Object.entries(v)){if(['__proto__','prototype','constructor'].includes(k))throw Error('Reserved object key');visit(x,depth+1);}}}visit(value,0);
}
export function parseContainer(value:unknown):GtmContainer {bounded(value);const c=containerSchema.parse(value);for(const [key,id]of [['tag','tagId'],['trigger','triggerId'],['variable','variableId'],['folder','folderId']] as const){const rows=c.containerVersion[key] as any[];if(new Set(rows.map(r=>r[id])).size!==rows.length)throw Error('Duplicate '+key+' IDs');}return c as GtmContainer;}
export function parseSnapshot(value:unknown):Snapshot|undefined {if(value===undefined||value===null)return undefined;bounded(value);return snapshotSchema.parse(value);}
export function evaluate(container:unknown,snapshot?:unknown){const c=parseContainer(container),s=parseSnapshot(snapshot);const result=evaluateGtmSignalQuality(c,s);if(!Number.isFinite(result.combinedScore)||result.dimensions.some(d=>!Number.isFinite(d.score)||d.score<0||d.score>1))throw Error('Evaluator returned an invalid score');return result;}
function references(c:GtmContainer){const cv=c.containerVersion,issues=new Set<string>();const triggers=new Set((cv.trigger??[]).map(x=>x.triggerId)),tags=new Set((cv.tag??[]).map(x=>x.tagId)),folders=new Set((cv.folder??[]).map(x=>x.folderId));for(const tag of cv.tag??[]){for(const id of [...tag.firingTriggerId??[],...(tag.blockingTriggerId as string[]??[])])if(!triggers.has(id)&&!['2147479553','2147479572','2147479573'].includes(id))issues.add('trigger:'+tag.tagId+':'+id);for(const seq of [...(tag.setupTag as any[]??[]),...(tag.teardownTag as any[]??[])])if(!tags.has(seq.tagName))issues.add('sequence:'+tag.tagId+':'+seq.tagName);}for(const row of [...cv.tag??[],...cv.variable??[],...cv.trigger??[]])if(row.parentFolderId&&!folders.has(row.parentFolderId))issues.add('folder:'+row.name+':'+row.parentFolderId);const variables=new Set([...(cv.variable??[]).map(v=>v.name),...(cv.builtInVariable??[]).map(v=>v.name),'_event']);for(const [kind,id,rows]of [['tag','tagId',cv.tag??[]],['trigger','triggerId',cv.trigger??[]],['variable','variableId',cv.variable??[]]] as const){for(const row of rows){for(const match of JSON.stringify(row).matchAll(/\{\{([^{}]+)\}\}/g))if(!variables.has(match[1]))issues.add('variable:'+kind+':'+(row as any)[id]+':'+match[1]);}}return issues;}
export function compare(original:unknown,candidate:unknown,snapshot?:unknown){
 const before=parseContainer(original),after=parseContainer(candidate),s=parseSnapshot(snapshot);
 const validation=validateMutation(after,before,JSON.stringify(before));const reasons:string[]=[];if(!validation.valid)reasons.push(validation.reason);
 for(const key of ['accountId','containerId','containerVersionId','container'])if(JSON.stringify(before.containerVersion[key])!==JSON.stringify(after.containerVersion[key]))reasons.push('Target metadata changed: '+key);
 for(const [key,id]of [['trigger','triggerId'],['variable','variableId'],['folder','folderId'],['builtInVariable','name']] as const){const a=before.containerVersion[key] as any[]??[],b=after.containerVersion[key] as any[]??[];for(const row of a)if(!b.some(x=>x[id]===row[id]))reasons.push('Removed '+key+': '+row[id]);}
 const oldRefs=references(before);for(const ref of references(after))if(!oldRefs.has(ref))reasons.push('New missing reference: '+ref);
 const previous=evaluate(before,s),result=evaluate(after,s);
 const regressions=result.dimensions.filter(d=>d.score<(previous.dimensions.find(x=>x.name===d.name)?.score??0)).map(d=>d.name);
 const oldErrors=new Set(previous.issues.filter(i=>i.severity==='error').map(i=>JSON.stringify(i)));const newErrors=result.issues.filter(i=>i.severity==='error'&&!oldErrors.has(JSON.stringify(i)));
 if(regressions.length)reasons.push('Dimension regression: '+regressions.join(', '));if(newErrors.length)reasons.push('New evaluator errors');
 const improved=result.combinedScore>previous.combinedScore;
 return {before:previous,after:result,delta:result.combinedScore-previous.combinedScore,eligible:reasons.length===0&&improved,status:reasons.length?'rejected':improved?'eligible-for-review':'no-improvement',reasons,regressions,published:false,applied:false,meaning:'Heuristic scores on supplied evidence. Eligibility is not approval, live validation, or measured business improvement.'};
}
