import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const dir=new URL('../supabase/functions/gtm-autoresearch/app/',import.meta.url);
test('actual report DOM renders side-by-side evidence safely and requires dismissal reason',async()=>{
 const dom=new JSDOM(await readFile(new URL('index.html',dir),'utf8'),{url:'https://fixture.example'});
 const calls=[],app={callServerTool:async req=>{calls.push(req);return {structuredContent:record};}},workspace={app,connect:async()=>{}};
 const source=(await readFile(new URL('app.js',dir),'utf8')).replace(/^import .*;\n/gm,'');
 const run=new Function('document','createAppWorkspace','URL','Blob','setTimeout','return (async()=>{'+source+'})();');
 const record={record:{id:'a'.repeat(64),document:{project:'demo',skillId:'tracking',kind:'proposal',occurredAt:'2026-09-09T00:00:00Z',payload:{container:{name:'<img src=x onerror=alert(1)>'},original:{name:'original'},snapshot:null}}},qa:{status:'recomputed-gtm-evidence',scope:'Supplied evidence only',result:{combinedScore:0.5,dimensions:[{name:'naming',score:0.5,weight:1}],issues:[]},comparison:{status:'eligible-for-review',before:{combinedScore:0.25,dimensions:[{name:'naming',score:0.25}]},after:{combinedScore:0.5},reasons:[],meaning:'Nothing applied'}},findings:[{id:'f',finding:'<script>bad()</script>',status:'pending',note:'',revision:0}]};
 await run(dom.window.document,()=>workspace,URL,Blob,setTimeout);app.ontoolresult({structuredContent:record});
 const doc=dom.window.document;assert.equal(doc.querySelectorAll('.cases article').length,2);assert.equal(doc.querySelectorAll('img').length,0);assert.equal(doc.querySelector('#detail script'),null);assert.ok(doc.body.textContent.includes('<script>bad()</script>'));
 const dismiss=[...doc.querySelectorAll('button')].find(x=>x.textContent==='Dismiss finding');dismiss.click();assert.equal(calls.length,0);assert.ok(doc.getElementById('notice').textContent.includes('reason'));
 doc.querySelector('textarea').value='Reviewed supplied trace';dismiss.click();await new Promise(r=>setTimeout(r,0));assert.equal(calls[0].name,'decide_review_finding');assert.equal(calls[0].arguments.revision,0);assert.equal(calls[0].arguments.note,'Reviewed supplied trace');
 app.ontoolresult({structuredContent:{...record,qa:{status:'historical-engine',reason:'Old engine'}}});assert.ok(doc.getElementById('detail').textContent.includes('Not verified'));assert.ok(!doc.getElementById('detail').textContent.includes('50.0%'));dom.window.close();
});
