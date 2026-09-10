import {createHash} from 'node:crypto';
import {assertExportTarget,type Target} from './target.ts';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const q=(s:string)=>"'"+s.replace(/'/g,"''")+"'";
export const MAX_CONTAINER_BYTES=20_000;
export const containerSchema=`CREATE TABLE IF NOT EXISTS gtm_container_files (client_id TEXT NOT NULL,account_id TEXT NOT NULL,container_id TEXT NOT NULL,run_id TEXT NOT NULL,version TEXT NOT NULL CHECK(version IN ('original','candidate')),json_bytes TEXT NOT NULL CHECK(json_valid(json_bytes)),sha256 TEXT NOT NULL,PRIMARY KEY(client_id,account_id,container_id,run_id,version)); CREATE TRIGGER IF NOT EXISTS gtm_container_files_immutable BEFORE UPDATE ON gtm_container_files BEGIN SELECT RAISE(ABORT,'Immutable container evidence'); END;`;
export function containerPlan(target:Target,runId:string,original:string,candidate:string){
 for(const id of [target.clientId,target.accountId,target.containerId,runId])if(typeof id!=='string'||!id.trim()||id.length>160)throw Error('Invalid identity');
 const files=([['original',original],['candidate',candidate]] as const).map(([version,bytes])=>{
 if(typeof bytes!=='string'||Buffer.byteLength(bytes)>MAX_CONTAINER_BYTES)throw Error('Full container exceeds 20000-byte limit');
 const obj=JSON.parse(bytes);assertExportTarget(target,obj);
 if(!obj.containerVersion||!obj.containerVersion.container||typeof obj.containerVersion.container!=='object'||Array.isArray(obj.containerVersion.container))throw Error('Missing complete container metadata');
 for(const key of ['tag','trigger','variable'])if(obj.containerVersion[key]!==undefined&&!Array.isArray(obj.containerVersion[key]))throw Error('Invalid container collection');
 return {version,bytes,sha256:sha(bytes)};
 });
 const ids=[target.clientId,target.accountId,target.containerId,runId];const where=['client_id','account_id','container_id','run_id'].map((k,i)=>k+'='+q(ids[i])).join(' AND ');
 return {target,runId,files,setupSql:containerSchema,writeSql:files.map(f=>`INSERT INTO gtm_container_files VALUES (${[...ids,f.version,f.bytes,f.sha256].map(q).join(',')}) ON CONFLICT(client_id,account_id,container_id,run_id,version) DO NOTHING;`).join('\n'),readSql:`SELECT * FROM gtm_container_files WHERE ${where} ORDER BY version;`};
}
export function verifyContainers(plan:ReturnType<typeof containerPlan>,rows:any[]){
 if(rows.length!==2)throw Error('Both full container versions required');
 for(const f of plan.files){const matches=rows.filter(r=>r.version===f.version);if(matches.length!==1)throw Error('Version mismatch');const r=matches[0];if(r.client_id!==plan.target.clientId||r.account_id!==plan.target.accountId||r.container_id!==plan.target.containerId||r.run_id!==plan.runId)throw Error('Identity mismatch');if(r.json_bytes!==f.bytes||sha(r.json_bytes)!==f.sha256||r.sha256!==f.sha256)throw Error('Container content mismatch');}
 return plan.files.map(f=>({version:f.version,bytes:f.bytes,sha256:f.sha256}));
}
