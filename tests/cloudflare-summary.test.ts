import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {summaryPlan,verifySummary} from '../src/cloudflare-summary.ts';
const original=JSON.parse(readFileSync(new URL('./fixtures/container.json',import.meta.url),'utf8'));const cv=original.containerVersion;const target={clientId:"demo's client",accountId:String(cv.accountId),containerId:String(cv.containerId),name:'Demo'};
const plan=()=>summaryPlan(target,'synthetic-test',original,original);
function sql(p:ReturnType<typeof plan>){const r=spawnSync('python3',['-c',`import sqlite3,json,sys
p=json.load(sys.stdin);c=sqlite3.connect(':memory:');c.row_factory=sqlite3.Row
c.executescript(p['setupSql']);c.executescript(p['writeSql']);c.executescript(p['writeSql'])
print(json.dumps([dict(x) for x in c.execute(p['readSql'])]))`],{input:JSON.stringify(p),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('SQL exact roundtrip is idempotent, escaped and bounded',()=>{const p=plan();assert.equal(verifySummary(p,sql(p)).verified,true);assert.ok(Buffer.byteLength(p.json)<12000)});
test('identity mismatch and corruption fail closed',()=>{const p=plan(),rows=sql(p);assert.throws(()=>verifySummary(p,[{...rows[0],client_id:'other'}]));assert.throws(()=>verifySummary(p,[{...rows[0],summary_json:rows[0].summary_json+' '} ]));assert.throws(()=>verifySummary(p,[]));assert.throws(()=>summaryPlan({...target,containerId:'wrong'},'run',original,original));});
test('run collision with changed evidence cannot verify',()=>{const p=plan(),rows=sql(p);const changed=structuredClone(original);changed.containerVersion.tag[0].name='Different';const newer=summaryPlan(target,'synthetic-test',original,changed);assert.throws(()=>verifySummary(newer,rows));});
