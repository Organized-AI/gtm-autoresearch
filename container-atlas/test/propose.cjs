// Proposed container: applies mechanical fixes to the Skyline sample and checks the re-audit.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ctx={console,URL,Math,JSON,Date,Int32Array};vm.createContext(ctx);
for (const [f,n] of [['gtm-auto.js','GTM_AUTO'],['engine.js','GTM_ENGINE'],['propose.js','GTM_PROPOSE']]) vm.runInContext(fs.readFileSync(__dirname+'/../src/'+f,'utf8')+`\n;globalThis.${n}=${n};`,ctx);
const E=ctx.GTM_ENGINE,P=ctx.GTM_PROPOSE,A=ctx.GTM_AUTO;
const read=n=>JSON.parse(fs.readFileSync(__dirname+'/../fixtures/'+n,'utf8'));
const up={web:read('sample-web.json'),server:read('sample-server.json')};
const snap=JSON.stringify(up);
const w=E.parseExport(up.web),s=E.parseExport(up.server);
const D=E.build({web:w,server:s,website:'skylinecharters.com'}),R=D.report;
const EXP={[w.info.publicId]:up.web,[s.info.publicId]:up.server};
const run=dec=>P.build({engine:E,auto:A,report:R,decisions:dec,exports:EXP,website:'skylinecharters.com'});
const out=run({});
assert.strictEqual(JSON.stringify(up),snap,'upload must not change');
for(const c of out.containers){
  console.log(c.publicId,'score',c.scoreBefore,'→',c.scoreAfter,'crit',c.critBefore,'→',c.critAfter,'review',c.reviewBefore,'→',c.reviewAfter,'changes',c.changes.length,'owner',c.owner.length);
  for(const x of c.changes) console.log('  ',x.action.padEnd(8),x.source.padEnd(8),x.name,'::',x.what);
  for(const o of c.owner) console.log('   OWNER',o.item.name,'::',o.reason);
  const b=P.diff(c.before,c.after); console.log('   blocks',b.length,'changed',b.filter(x=>x.status!=='same').map(x=>x.status[0]+':'+x.kind+' '+x.name).join(' | '));
  assert(c.scoreAfter>=c.scoreBefore,'score must not drop');
  assert(c.critAfter<=c.critBefore,'no new critical findings');
}
const web=out.containers[0];
assert(web.critAfter<web.critBefore,'web fix-first count drops');
// a GTM note that says "keep" blocks removal; a note that says "remove" is cited
const wa=web.after.containerVersion;
assert(wa.trigger.find(t=>t.name==='Click - Call Button'),'the CallRail trigger noted "Do not delete" stays');
assert(web.owner.some(o=>o.item.name==='Click - Call Button'&&/Do not delete/.test(o.reason)));
assert(out.containers[1].changes.some(c=>c.name==='Debug - everything'&&/note agrees/.test(c.what)));
const coupon=wa.variable.find(v=>v.name==='DLV - coupon'); assert(coupon&&+coupon.variableId>37,'new variable gets a fresh ID, never a removed one');
// decisions: Intended keeps an element, Ask owner moves it to the owner list
const ua=R.items.find(i=>i.check==='Duplicates'&&i.kind==='tag'), unused=R.items.find(i=>i.check==='Unused'&&i.name==='JS - Old Cart Total');
const out2=run({[ua.key]:{d:'keep'},[unused.key]:{d:'ask'}});
const cv2=out2.containers[0].after.containerVersion;
assert(!cv2.tag.some(t=>/TikTok Pixel - Base/.test(t.name)&&t.paused),'Intended leaves both TikTok tags running');
assert(out.containers[0].after.containerVersion.tag.find(t=>t.name==='TikTok Pixel - Base (copy)').paused,'default pauses the copy');
assert(cv2.variable.find(v=>v.name==='JS - Old Cart Total'),'Ask owner keeps the variable');
assert(out2.owner.some(o=>o.item.key===unused.key));
// the proposed file re-imports cleanly
const again=E.parseExport(JSON.stringify(web.after)); assert.strictEqual(again.info.publicId,'GTM-SKY7Q2L');
fs.writeFileSync(__dirname+'/proposed.md',P.markdown(out));
console.log('ok');
