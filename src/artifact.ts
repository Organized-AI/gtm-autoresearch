import {compare,ENGINE} from './connected.ts';
import {summaryPlan} from './cloudflare-summary.ts';
export function artifact(original:unknown,candidate:unknown){
 const originalBytes=typeof original==='string'?original:JSON.stringify(original,null,2);const candidateBytes=typeof candidate==='string'?candidate:JSON.stringify(candidate,null,2);original=JSON.parse(originalBytes);candidate=JSON.parse(candidateBytes);
 const evidence={originalBytes,candidateBytes,version:1,engine:ENGINE,scope:'Synthetic fixture; no live GTM access',comparison:compare(original,candidate),original,candidate};
 const cv=(original as any).containerVersion;
 const storage=summaryPlan({clientId:'synthetic-demo',accountId:String(cv.accountId),containerId:String(cv.containerId),name:'Synthetic demo'},'demo-'+Date.now(),original,candidate);
 const json=JSON.stringify({...evidence,storage}).replace(/</g,'\\u003c');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GTM Autoresearch · Jordaaan</title><style>
:root{
  color-scheme:dark;
  --bg:#0c0b09;
  --surface:#141210;
  --card:#1a1814;
  --card-hover:#211e18;
  --line:#2a2520;
  --gold:#F5D623;
  --gold-hover:#FFE94A;
  --gold-dim:#8B7A12;
  --text:#f0ece4;
  --dim:#a09888;
  --gap:#8a7f6f;
  --mono:'JetBrains Mono','IBM Plex Mono','SF Mono',Consolas,monospace;
  --sans:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 var(--sans)}
header{border-bottom:1px solid var(--line);padding:18px 28px;display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}
.wordmark{font:700 20px/1 var(--mono);letter-spacing:.04em;text-transform:uppercase;color:var(--text)}
.wordmark .gold{color:var(--gold)}
.attribution{font:12px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
main{max-width:1240px;margin:auto;padding:32px 24px}
.label{font:12px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--gold)}
h1{font:600 clamp(28px,4.6vw,48px)/1.1 var(--mono);max-width:22ch}
h2,h3{font-family:var(--mono)}
.dim{color:var(--dim)}
.preview-flag{background:var(--card);border:1px solid var(--gold);border-radius:8px;padding:14px 18px;font:13px/1.55 var(--mono);color:var(--text);margin:18px 0 26px}
.preview-flag b{color:var(--gold)}
.overview{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0 8px}
.overview .ocard{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px}
.overview .ocard .name{font:13px var(--mono);color:var(--text)}
.overview .ocard .stat{font:22px var(--mono);margin:6px 0 2px}
.overview .ocard .rev{font-size:12px}
.rev.ok{color:#88d3a3}
.rev.review{color:#ffae8e}
.gapnote{font:12px var(--mono);letter-spacing:.03em;color:var(--gap);margin:6px 0 24px}
nav{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0 30px}
button{font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px;cursor:pointer;text-align:left;font-family:var(--mono)}
button:hover,button[aria-pressed=true]{border-color:var(--gold);background:var(--card-hover)}
button:focus-visible,summary:focus-visible{outline:2px solid var(--gold);outline-offset:4px}
.count{font:26px var(--mono);display:block;margin:10px 0 3px;color:var(--gold)}
.small{font-size:13px}
.gapcard{border-style:dashed;border-color:var(--gap)}
.gapcard:hover,.gapcard[aria-pressed=true]{border-color:var(--gap);background:var(--card-hover)}
.gaptag{display:inline-block;font:11px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--gap);border:1px solid var(--gap);border-radius:20px;padding:2px 8px;margin-bottom:8px}
.panel,.case{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:24px;margin:18px 0}
.panel.gap{border-style:dashed;border-color:var(--gap)}
.metrics{display:flex;flex-wrap:wrap;gap:22px}
.metrics>div{min-width:150px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}
pre{font:13px/1.6 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;background:var(--surface);padding:16px;border-radius:6px;max-height:480px;overflow:auto}
table{width:100%;border-collapse:collapse;font-size:13px;font-family:var(--sans)}
th{font-family:var(--mono);letter-spacing:.04em;text-transform:uppercase;font-size:11px;color:var(--dim)}
th,td{text-align:left;padding:12px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
td{max-width:300px}
.table-scroll{overflow:auto}
.pass{color:#88d3a3}
.fail{color:#ffae8e}
summary{cursor:pointer;padding:10px 0;color:var(--gold);font-family:var(--mono)}
.pill{font:12px var(--mono);letter-spacing:.06em;text-transform:uppercase;padding:5px 10px;border:1px solid var(--gold);color:var(--gold);border-radius:20px}
.actions{display:flex;gap:10px;flex-wrap:wrap}
.actions button{padding:8px 14px;font-size:13px}
.actions button:disabled{opacity:.4;cursor:not-allowed}
.btn-primary{background:var(--gold);color:#141005;border-color:var(--gold);font-weight:700}
.btn-primary:hover{background:var(--gold-hover);border-color:var(--gold-hover);color:#141005}
.finding-row{border:1px solid var(--line);border-radius:8px;padding:14px;margin:10px 0;display:flex;justify-content:space-between;align-items:flex-start;gap:14px}
.finding-row p{margin:0;flex:1}
footer{color:var(--dim);font-size:12px;margin-top:30px;font-family:var(--mono)}
#detail:focus{outline:none}
#saveLocal textarea{width:100%;min-height:140px;background:var(--surface);color:var(--text);border:1px solid var(--line);padding:12px;font:12px var(--mono)}
.savebox{margin-top:14px}
dialog{background:var(--bg);color:var(--text);border:1px solid var(--gold);border-radius:12px;width:min(1300px,96vw);max-height:92vh;padding:24px}
dialog::backdrop{background:#000b}
.dialog-head{display:flex;justify-content:space-between;align-items:center;gap:20px;position:sticky;top:-24px;background:var(--bg);z-index:1}
.case-columns{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.case-columns article{min-width:0}
.finding{border:1px solid var(--line);padding:15px;border-radius:8px;margin:12px 0}
#requestText{width:100%;min-height:160px;background:var(--surface);color:var(--text);border:1px solid var(--line);padding:14px;font:13px/1.5 var(--mono)}
.request-status{font:13px var(--mono);color:var(--gold);margin:10px 0}
.request-instructions{font-size:13px;color:var(--dim)}
@media(max-width:900px){.overview{grid-template-columns:1fr 1fr}nav{grid-template-columns:1fr 1fr}.pair{grid-template-columns:1fr}}
@media(max-width:760px){header{align-items:flex-start;flex-direction:column}main{padding:22px 14px}.panel,.case{padding:16px}.overview{grid-template-columns:1fr 1fr}.case-columns{grid-template-columns:1fr}}

.gold,a{color:var(--gold)}h2{font-size:18px}h3{font-size:14px}.intro{color:var(--dim);max-width:760px}.overview .stat{color:var(--gold)}.overview{margin:24px 0}.panel[hidden]{display:none}.tab-name{display:block;font-size:15px;margin:5px 0}.tab-note{font:12px/1.5 var(--sans);color:var(--dim)}nav button{padding:16px}.panel>h2{margin-top:0}.toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.toolbar label{font:12px var(--mono);color:var(--dim)}select{padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--text);font:13px var(--mono)}textarea{width:100%;min-height:160px;background:var(--surface);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:14px;font:12px/1.6 var(--mono)}.status{font:12px/1.6 var(--mono);color:var(--dim)}.text-link{font:13px var(--mono)}.finding-row{display:block}.finding-row strong{font:12px var(--mono);color:var(--gold)}.finding-row p{margin-top:8px;overflow-wrap:anywhere}.evidence-pair>div{min-width:0}footer{border-top:1px solid var(--line);padding:24px 0;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}a:focus-visible,select:focus-visible{outline:2px solid var(--gold);outline-offset:4px}@media(max-width:520px){nav{grid-template-columns:1fr 1fr}.overview .stat{font-size:20px}}
</style></head><body>
<header><span class="wordmark">ORGANIZED <span class="gold">AI</span></span><span class="pill">CONTAINER QA PREVIEW</span><span class="attribution">GTM AUTORESEARCH · WITH <a href="https://www.linkedin.com/in/jordaaanhill" target="_blank" rel="noopener noreferrer">JORDAAAN</a></span></header>
<main><div class="label">GTM AUTORESEARCH / CONTAINER REVIEW</div><h1>A clearer view.<br>A better-informed change.</h1><p class="intro">Compare your container versions, inspect the findings, and choose your next step. Your original stays unchanged.</p>
<div class="preview-flag"><b>Synthetic preview.</b> These are actual evaluator results on an example container. No live GTM access, changes applied, or cloud connection is implied.</div>
<div class="label">OVERVIEW — ORIGINAL / CANDIDATE</div><div class="overview"><div class="ocard"><div class="name">Original score</div><div class="stat" id="before-score">—</div><div class="rev">Heuristic quality</div></div><div class="ocard"><div class="name">Candidate score</div><div class="stat" id="after-score">—</div><div class="rev">Requires review</div></div><div class="ocard"><div class="name">Candidate findings</div><div class="stat" id="finding-count">—</div><div class="rev">Evaluator observations</div></div><div class="ocard"><div class="name">Container</div><div class="stat" id="container-id">—</div><div class="rev" id="account-id">—</div></div></div>
<p class="gapnote" id="target"></p>
<nav aria-label="Container report sections"><button data-panel="comparison-panel" aria-pressed="true" aria-controls="comparison-panel"><span class="label">01 / COMPARE</span><span class="tab-name">Version checks</span><span class="tab-note">See what changed in the scores.</span></button><button data-panel="findings-panel" aria-pressed="false" aria-controls="findings-panel"><span class="label">02 / REVIEW</span><span class="tab-name">Findings</span><span class="tab-note">Understand what needs attention.</span></button><button data-panel="evidence-panel" aria-pressed="false" aria-controls="evidence-panel"><span class="label">03 / EXPORT</span><span class="tab-name">Container JSON</span><span class="tab-note">Compare files and download.</span></button><button data-panel="history-panel" aria-pressed="false" aria-controls="history-panel"><span class="label">04 / HISTORY</span><span class="tab-name">Save & resume</span><span class="tab-note">Prepare your storage request.</span></button></nav>
<section class="panel" id="comparison-panel"><h2>Version comparison</h2><p id="result" class="status"></p><div class="table-scroll"><table><thead><tr><th>Dimension</th><th>Original</th><th>Candidate</th></tr></thead><tbody id="dimensions"></tbody></table></div><p class="small dim">Heuristic quality scores assess the supplied export. They do not verify live tag firing or measure business improvement.</p><div class="actions"><button id="review" class="btn-primary">Prepare review request</button></div><p id="review-status" class="status" role="status"></p></section>
<section class="panel" id="findings-panel" hidden><h2>Candidate findings</h2><p class="small dim">Review the evidence before changing or importing a container.</p><div id="findings"></div></section>
<section class="panel" id="evidence-panel" hidden><h2>Container JSON</h2><div class="toolbar"><label for="download-version">Version</label><select id="download-version"><option value="original">Original container</option><option value="candidate">Candidate — requires review</option></select><div class="actions"><button id="download-json" class="btn-primary">Download JSON</button></div><a class="text-link" id="gtm-import" href="https://tagmanager.google.com/" target="_blank" rel="noopener noreferrer">Open GTM to import ↗</a></div><p id="download-status" class="status" role="status">Downloads preserve the selected container bytes. Nothing is imported or published.</p><details><summary>Import steps and download help</summary><p class="small dim">Open the matching container’s import screen, choose the downloaded JSON, then review the destination workspace and Merge/Overwrite options. If IDs are unavailable, use Admin → Import Container. Importing is separate from publishing. If Claude blocks a download, ask it to attach the selected JSON as a file.</p></details><div class="pair evidence-pair"><div><h3>Original</h3><pre id="original"></pre></div><div><h3>Candidate</h3><pre id="candidate"></pre></div></div></section>
<section class="panel" id="history-panel" hidden><h2>Save & resume</h2><div class="toolbar"><label for="backend">History backend</label><select id="backend"><option value="cloudflare">Cloudflare D1</option><option value="chumbo">Chumbo / Supabase</option></select></div><p id="connection" class="status">Not connected in this standalone preview. Choosing a backend does not connect it.</p><div class="actions"><button id="save" class="btn-primary">Save QA summary request</button><button id="full-save">Save full container request</button></div><details><summary>What each save option includes</summary><p class="small dim">The summary stores QA history, not restorable container files. Full container storage requires the configured file-backed Cloudflare API tool and supports up to 20 KB per version; larger exports are rejected. Chumbo requires its supported adapter. Your assistant must verify access and exact readback before reporting a successful save.</p></details></section>
<section class="panel" id="request-panel" hidden><h2>Your next step</h2><p id="status" class="status" role="status">No request prepared. Nothing saved or applied.</p><textarea id="request" readonly aria-label="Assistant request"></textarea><p class="small dim">Copy this request, close the preview, and send it to Claude with this HTML file available. The action is complete only after Claude runs it and verifies the result.</p></section>
<footer><span>ORGANIZED AI · GTM AUTORESEARCH · ORIGINAL UNCHANGED</span><a href="https://www.linkedin.com/in/jordaaanhill" target="_blank" rel="noopener noreferrer">Jordaaan on LinkedIn ↗</a></footer></main><script type="application/json" id="evidence">${json}</script><script>const d=JSON.parse(document.getElementById('evidence').textContent),c=d.comparison;const text=(id,v)=>document.getElementById(id).textContent=v;const cv=d.original.containerVersion;
const showPanel=id=>{document.querySelectorAll('[data-panel]').forEach(b=>{const active=b.dataset.panel===id;b.setAttribute('aria-pressed',String(active));document.getElementById(b.dataset.panel).hidden=!active;});};
document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>showPanel(b.dataset.panel));
text('before-score',(c.before.combinedScore*100).toFixed(1)+'%');text('after-score',(c.after.combinedScore*100).toFixed(1)+'%');text('finding-count',String(c.after.issues.length));text('container-id',String(cv.containerId||'Unspecified'));text('account-id','Account '+(cv.accountId||'unspecified'));
if(/^[0-9]+$/.test(String(cv.accountId||''))&&/^[0-9]+$/.test(String(cv.containerId||''))){document.getElementById('gtm-import').href='https://tagmanager.google.com/#/admin/accounts/'+cv.accountId+'/containers/'+cv.containerId+'/import';}text('target','Demo client · Account '+(cv.accountId||'unspecified')+' · Container '+(cv.containerId||'unspecified')+' · Engine '+d.engine);text('result',c.status+' · '+c.before.combinedScore+' → '+c.after.combinedScore);for(const x of c.before.dimensions){const row=document.createElement('tr');for(const v of [x.name,x.score,c.after.dimensions.find(y=>y.name===x.name)?.score]){const td=document.createElement('td');td.textContent=String(v);row.append(td)}document.getElementById('dimensions').append(row)}for(const x of c.after.issues){const p=document.createElement('article');p.className='finding-row';const title=document.createElement('strong');title.textContent=String(x.severity||'Finding').toUpperCase();const body=document.createElement('p');body.textContent=x.message||JSON.stringify(x);p.append(title,body);document.getElementById('findings').append(p)}if(!c.after.issues.length)text('findings','No findings in these evaluator checks. This is not a live tracking verification.');text('original',JSON.stringify(d.original,null,2));text('candidate',JSON.stringify(d.candidate,null,2));function prepare(action){document.getElementById('request-panel').hidden=false;const backend=document.getElementById('backend').value;document.getElementById('request').value=action+' for the synthetic GTM Autoresearch evidence embedded in the attached HTML. Backend: '+backend+'. For Cloudflare, read storage.setupSql, storage.writeSql, and storage.readSql directly from the embedded evidence; execute them in that order in the user-selected D1 database. Compare the actual returned summary_json byte-for-byte to storage.json, verify its SHA-256 equals storage.sha256, and check client/account/container/run identity. Only then report Saved and verified. This saves a compact QA summary, not restorable container files. For Chumbo, use its supported adapter or report unavailable. Read the evidence file directly. Confirm client and container identity. Do not modify or publish GTM. If saving is supported, save a new immutable record and verify exact readback; otherwise report the missing adapter. Do not claim this preview is connected.';text('status','Request prepared — nothing sent, saved, or applied.')}document.getElementById('save').onclick=()=>prepare('Save history');document.getElementById('full-save').onclick=()=>{document.getElementById('request-panel').hidden=false;document.getElementById('request').value='Save BOTH complete original and candidate container JSON from this artifact using the file-backed scripts/container-store.ts API transfer. Preserve originalBytes and candidateBytes exactly. Resolve the authorized client/account/container first. Verify both hashes and restore both files before reporting success. This path currently supports at most 20000 UTF-8 bytes per version; never truncate. If this chat cannot run the authenticated file-backed API tool, report that limitation; do not substitute a summary or transcribe encoded payloads. No GTM import or publish.';text('status','Full container request prepared; not saved. Requires file-backed Cloudflare API tool.');};document.getElementById('review').onclick=()=>{document.getElementById('request-panel').hidden=false;document.getElementById('request').value='Review the original and candidate GTM container evidence in this HTML. Confirm client/account/container identity, compare each changed entity and evaluator finding, and explain tradeoffs and required live validation. Preserve exact evidence and scores. Do not save, import, apply, or publish changes as part of this review request.';text('status','Review request prepared — no changes applied.');text('review-status','Your review request is ready in the next-step panel below.');document.getElementById('request-panel').scrollIntoView({behavior:'smooth',block:'start'});};document.getElementById('download-json').onclick=()=>{const version=document.getElementById('download-version').value;const selected=version==='candidate'?d.candidate:d.original;const id=String(selected.containerVersion?.containerId||'unknown').replace(/[^a-zA-Z0-9_-]/g,'_');const blob=new Blob([version==='candidate'?d.candidateBytes:d.originalBytes],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='gtm-'+id+'-'+version+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);text('download-status','Download requested: '+version+'. Not imported or published. If no file appears, ask Claude to attach this selected JSON.');};</script></body></html>`;
}
