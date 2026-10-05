// Intake flow: import web export → confirm website → add sGTM export or skip → build the atlas.
(() => {
'use strict';
const $ = id => document.getElementById(id), E = GTM_ENGINE;
const st = { web: null, server: null, site: null, sample: false };
const SAMPLE = JSON.parse(document.getElementById('sample-data').textContent);
window.__exports = {};

function state(step, s, done) { const el = $(step); el.dataset.state = s; if (done != null) $(step.replace('step', 's') + 'done').textContent = done; }
function err(id, msg) { const e = $(id); e.textContent = msg || ''; e.hidden = !msg; }
function summary(p) { const c = p.counts; return `${p.info.name} · ${p.info.publicId} · ${p.info.context === 'server' ? 'server' : 'web'} · ${c.tags} tags · ${c.triggers} triggers · ${c.variables} variables${c.clients ? ' · ' + c.clients + ' clients' : ''}`; }
function read(file) { return file.text(); }
function wireDrop(labelId, inputId, onText) {
  const drop = $(labelId), inp = $(inputId);
  inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; if (f) read(f).then(onText); inp.value = ''; });
  if (!drop) return;
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) read(f).then(onText); });
}

/* step 1 */
function takeFirst(text) {
  err('err1');
  let p; try { p = E.parseExport(text); } catch (e) { return err('err1', e.message); }
  if (p.info.context === 'server') { st.server = p; $('serverFirst').hidden = false; $('drop1').hidden = true; state('step1', 'active', summary(p)); return; }
  st.web = p; doneStep1();
}
function takeWebAfterServer(text) {
  err('err1');
  let p; try { p = E.parseExport(text); } catch (e) { return err('err1', e.message); }
  if (p.info.context === 'server') return err('err1', 'That is also a server container. Import the web container that sends to it.');
  st.web = p; doneStep1();
}
function doneStep1() {
  state('step1', 'done', [st.web, st.server].filter(Boolean).map(summary).join('  +  '));
  state('step2', 'active'); siteStep();
}
wireDrop('drop1', 'file1', takeFirst);
wireDrop(null, 'file1b', takeWebAfterServer);
$('serverOnly').onclick = () => doneStep1();
$('sample').onclick = () => { st.sample = true; takeFirst(JSON.stringify(SAMPLE.web)); };

/* step 2 */
function siteStep() {
  const cands = E.detectWebsite(st.web && st.web.cv, st.server && st.server.cv), box = $('siteChips'); box.textContent = '';
  if (cands.length) {
    $('site').value = cands[0].domain;
    $('siteHint').textContent = 'Found in the container: ' + cands[0].sources.join(', ') + '. Confirm it, pick another, or type the right one.';
    cands.forEach((c, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip-btn'; b.textContent = c.domain;
      const s = document.createElement('small'); s.textContent = c.sources[0]; b.append(s); b.setAttribute('aria-pressed', String(i === 0));
      b.onclick = () => { $('site').value = c.domain; [...box.children].forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
      box.append(b);
    });
  } else $('siteHint').textContent = 'No website was found in the container settings. Type the domain this container runs on.';
  setTimeout(() => $('site').focus(), 50);
}
$('siteForm').addEventListener('submit', e => {
  e.preventDefault(); err('err2');
  const raw = $('site').value.trim(), host = E.hostOf(raw), d = host && E.rootDomain(host);
  if (!d || !/\.[a-z]{2,}$/i.test(d)) return err('err2', 'Enter a domain such as example.com.');
  st.site = d; state('step2', 'done', d);
  if (st.server) return finish();
  state('step3', 'active'); $('sample3').hidden = !st.sample;
});

/* step 3 */
wireDrop('drop3', 'file3', text => {
  err('err3');
  let p; try { p = E.parseExport(text); } catch (e) { return err('err3', e.message); }
  if (p.info.context !== 'server') return err('err3', 'This is a web container. Choose the server (sGTM) container export, or skip this step.');
  st.server = p; state('step3', 'done', summary(p)); finish();
});
$('skip3').onclick = () => { state('step3', 'done', 'Skipped, web container only'); finish(); };
$('sample3').onclick = () => { st.server = E.parseExport(JSON.stringify(SAMPLE.server)); state('step3', 'done', summary(st.server)); finish(); };

/* build */
function finish() {
  const veil = document.createElement('div'); veil.className = 'building'; veil.textContent = 'AUDITING ' + [st.web, st.server].filter(Boolean).map(p => p.info.publicId).join(' + '); document.body.append(veil);
  setTimeout(() => {
    let D;
    try { D = E.build({ web: st.web, server: st.server, website: st.site }); }
    catch (e) { veil.remove(); state('step1', 'active'); return err('err1', 'The audit could not finish: ' + e.message); }
    [st.web, st.server].forEach(p => { if (p) window.__exports[p.info.publicId] = p.doc; });
    window.__report = D.report;
    $('intake').hidden = true; $('app').hidden = false; veil.remove();
    window.bootAtlas(D);
    reportBar(D.report);
    review(D.report);
  }, 60);
}

/* guided review: one checkpoint at a time, each finding gets a decision */
const CHECKPOINTS = [
  ['References', 'Broken references', 'Settings that point at a variable, trigger or folder that does not exist. GTM keeps publishing, but the tag sends an empty value or never fires.'],
  ['Parameters', 'Parameter integrity', 'Blank required settings, IDs typed into tags instead of a variable, plain-text access tokens, and endpoints or hostnames that do not match the site.'],
  ['Signal flow', 'Web → server routes', 'Every event the web container sends to sGTM, followed to the platform it reaches. Dead ends are events that arrive and go nowhere.'],
  ['Duplicates', 'Duplicates', 'Elements with identical settings. Some are intentional; many are copies that drift apart later.'],
  ['Unused', 'Unused elements', 'Triggers and variables nothing references, and tags with no trigger. Confirm before removing: other containers or custom code can still use them.'],
  ['Legacy', 'Legacy tags', 'Universal Analytics and other retired tag types.'],
  ['Naming', 'Naming', 'Generic or empty names that make the container hard to read.'],
];
const RV = { cp: 0, dec: {}, key: '', list: [], jev: {} };
const DEC = { fix: 'Will fix', keep: 'Intended', ask: 'Ask owner' };
function persist() { try { localStorage.setItem(RV.key, JSON.stringify(RV.dec)); } catch (e) { /* storage blocked */ } }
function review(R) {
  RV.key = 'atlas-review:' + R.containers.map(c => c.publicId).join('+');
  try { RV.dec = JSON.parse(localStorage.getItem(RV.key) || '{}') || {}; } catch (e) { RV.dec = {}; }
  RV.list = CHECKPOINTS.map(([check, title, why]) => ({ title, why, items: R.items.filter(i => i.check === check) })).filter(c => c.items.length);
  const extra = R.items.filter(i => !CHECKPOINTS.some(c => c[0] === i.check));
  if (extra.length) RV.list.push({ title: 'Other findings', why: 'Findings outside the standard checkpoints.', items: extra });
  RV.list.push({ title: 'Housekeeping and sign-off', why: 'Low-risk notes, grouped. Then download the report with your decisions in it.', items: [], notes: R.notes, final: true });
  RV.total = R.items.length;
  $('rvClose').onclick = () => openReview(false);
  $('rvPrev').onclick = () => go(RV.cp - 1);
  $('rvNext').onclick = () => go(RV.cp + 1);
  openReview(true); go(0); jevBar();
}
function openReview(on) { $('review').hidden = !on; document.querySelector('.workspace').classList.toggle('reviewing', on); $('reviewBtn').setAttribute('aria-pressed', String(on)); requestAnimationFrame(() => { window.dispatchEvent(new Event('resize')); const f = $('fit'); if (f && !$('svg').closest('[hidden]')) f.click(); }); }
function decided(list) { return list.filter(i => RV.dec[i.key]).length; }
function go(i) {
  RV.cp = Math.max(0, Math.min(RV.list.length - 1, i));
  const cp = RV.list[RV.cp];
  $('rvEyebrow').textContent = 'Checkpoint ' + (RV.cp + 1) + ' of ' + RV.list.length;
  $('rvTitle').textContent = cp.title + (cp.items.length ? ' · ' + cp.items.length : '');
  $('rvWhy').textContent = cp.why;
  $('rvPrev').disabled = RV.cp === 0; $('rvNext').hidden = RV.cp === RV.list.length - 1;
  const nav = $('rvCps'); nav.textContent = '';
  RV.list.forEach((c, k) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = c.title;
    if (c.items.length) { const n = document.createElement('i'); n.textContent = decided(c.items) + '/' + c.items.length; b.append(n); }
    if (c.items.length && decided(c.items) === c.items.length) b.classList.add('complete');
    if (k === RV.cp) b.setAttribute('aria-current', 'step');
    b.onclick = () => go(k); nav.append(b);
  });
  const box = $('rvList'); box.textContent = ''; box.scrollTop = 0;
  cp.items.forEach(it => box.append(card(it)));
  if (cp.final) finalCard(box, cp.notes);
  if ($('rvJev') && API.jev) $('rvJev').hidden = !!cp.final;
  paintJev && Object.keys(RV.jev).length && paintJev();
  progress();
}
function progress() {
  const all = RV.list.flatMap(c => c.items), n = decided(all);
  $('rvBar').style.width = (RV.total ? 100 * n / RV.total : 100) + '%';
  const by = { fix: 0, keep: 0, ask: 0 }; Object.keys(RV.dec).forEach(k => { if (all.some(i => i.key === k)) by[RV.dec[k].d]++; });
  $('rvCount').textContent = RV.total ? `${n} of ${RV.total} findings decided · ${by.fix} to fix · ${by.keep} intended · ${by.ask} to ask` : 'No findings need a decision.';
  [...$('rvCps').children].forEach((b, k) => { const c = RV.list[k]; if (!c.items.length) return; b.querySelector('i').textContent = decided(c.items) + '/' + c.items.length; b.classList.toggle('complete', decided(c.items) === c.items.length); });
}
function card(it) {
  const el = document.createElement('article'); el.className = 'rv-item ' + it.severity + (RV.dec[it.key] ? ' decided' : '');
  const name = document.createElement('button'); name.type = 'button'; name.className = 'rv-name'; name.textContent = it.name; name.title = 'Show in the diagram';
  name.onclick = () => window.atlasFocus && window.atlasFocus(it.tab, it.nodeId);
  const meta = document.createElement('div'); meta.className = 'rv-meta'; meta.textContent = `${E.SEV_LABEL[it.severity]} · ${it.container} · ${it.kind} ${it.ref}`;
  const msg = document.createElement('p'); msg.className = 'rv-msg'; msg.textContent = it.message;
  const dec = document.createElement('div'); dec.className = 'rv-dec';
  const note = document.createElement('input'); note.className = 'rv-note'; note.id = 'note-' + btoa(unescape(encodeURIComponent(it.key))).replace(/[^a-z0-9]/gi, '').slice(0, 40);
  note.placeholder = 'Note for the report (optional)'; note.setAttribute('aria-label', 'Note for ' + it.name);
  note.value = (RV.dec[it.key] || {}).note || ''; note.hidden = !RV.dec[it.key];
  note.oninput = () => { if (RV.dec[it.key]) { RV.dec[it.key].note = note.value; persist(); } };
  const decide = (d, toggle) => {
      const cur = RV.dec[it.key];
      if (toggle && cur && cur.d === d) delete RV.dec[it.key]; else RV.dec[it.key] = { d, note: (cur && cur.note) || note.value, jev: RV.jev[it.key] && RV.jev[it.key].decision === d ? RV.jev[it.key].confidence : undefined };
      if (typeof jevSummary === 'function' && Object.keys(RV.jev).length) setTimeout(jevSummary);
      [...dec.children].forEach(x => x.setAttribute('aria-pressed', String((RV.dec[it.key] || {}).d === x.dataset.d)));
      el.classList.toggle('decided', !!RV.dec[it.key]); note.hidden = !RV.dec[it.key]; persist(); progress();
      if (RV.dec[it.key] && window.gsap && !matchMedia('(prefers-reduced-motion: reduce)').matches) gsap.fromTo(el, { scale: .985 }, { scale: 1, duration: .25, ease: 'power2.out' });
  };
  Object.keys(DEC).forEach(d => {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.d = d; b.textContent = DEC[d];
    b.setAttribute('aria-pressed', String((RV.dec[it.key] || {}).d === d));
    b.onclick = () => decide(d, true);
    dec.append(b);
  });
  const jv = document.createElement('div'); jv.className = 'rv-jev'; jv.hidden = true;
  el.append(name, meta, msg, dec, note, jv);
  el.dataset.key = it.key; el.decide = decide; el.jevSlot = jv;
  if (RV.jev[it.key]) jevChip(el, RV.jev[it.key]);
  return el;
}
function finalCard(box, notes) {
  notes.forEach(g => {
    const d = document.createElement('div'); d.className = 'rv-group';
    const b = document.createElement('b'); b.textContent = g.count + ' × ' + g.message; d.append(b, document.createElement('br'), document.createTextNode(g.container + ' · e.g. ' + g.examples.join(', ')));
    box.append(d);
  });
  const done = document.createElement('div'); done.className = 'rv-done';
  const all = RV.list.flatMap(c => c.items), n = decided(all);
  done.textContent = n === RV.total ? 'Every finding has a decision. Download the report; your decisions and notes are in it.' : (RV.total - n) + ' findings still have no decision. You can download the report now; undecided findings are listed as open.';
  const row = document.createElement('div'); row.className = 'in-row';
  [['Preview PDF', 'previewBtn'], ['Download PDF', 'pdfBtn'], ['Download Markdown', 'mdBtn']].forEach(([t, id], k) => { const b = document.createElement('button'); b.type = 'button'; b.className = k ? 'btn ghost' : 'btn'; b.textContent = t; b.onclick = () => $(id).click(); row.append(b); });
  box.append(formatPanel(), done, row, watchPanel());
}

/* report format: what the downloads include and how they are titled */
const FMT_KEY = 'atlas-report-format';
const SECTIONS = [['fix', 'Fix first'], ['confirm', 'Confirm'], ['flow', 'Signal flow'], ['notes', 'Housekeeping notes'], ['inventory', 'Inventory'], ['scope', 'What this audit did not check']];
const ACCENTS = [['Brass', [150, 118, 0]], ['Ink', [23, 21, 15]], ['Teal', [0, 118, 128]], ['Indigo', [64, 72, 168]], ['Crimson', [170, 40, 60]]];
let FMT = { title: '', preparedBy: '', preparedFor: '', accent: 0, sections: { fix: true, confirm: true, flow: true, notes: true, inventory: true, scope: true }, decisions: true };
try { FMT = Object.assign(FMT, JSON.parse(localStorage.getItem(FMT_KEY) || '{}')); } catch (e) { /* storage blocked */ }
function saveFmt() { try { localStorage.setItem(FMT_KEY, JSON.stringify(FMT)); } catch (e) { /* storage blocked */ } }
function formatPanel() {
  const f = document.createElement('fieldset'); f.className = 'rv-format';
  const lg = document.createElement('legend'); lg.textContent = 'Report format'; f.append(lg);
  const field = (label, key, ph) => { const l = document.createElement('label'); l.textContent = label; const i = document.createElement('input'); i.id = 'fmt-' + key; i.value = FMT[key] || ''; i.placeholder = ph; i.oninput = () => { FMT[key] = i.value; saveFmt(); }; l.append(i); return l; };
  f.append(field('Report title', 'title', 'GTM container audit'), field('Prepared by', 'preparedBy', 'Your name or agency'), field('Prepared for', 'preparedFor', 'Client or team'));
  const sw = document.createElement('div'); sw.className = 'rv-swatches'; sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', 'Accent color');
  ACCENTS.forEach(([n, c], i) => { const b = document.createElement('button'); b.type = 'button'; b.title = n; b.setAttribute('aria-label', n); b.style.background = 'rgb(' + c.join(',') + ')'; b.setAttribute('aria-pressed', String(FMT.accent === i)); b.onclick = () => { FMT.accent = i; saveFmt(); [...sw.children].forEach((x, k) => x.setAttribute('aria-pressed', String(k === i))); }; sw.append(b); });
  const sl = document.createElement('p'); sl.className = 'rv-flabel'; sl.textContent = 'Accent'; f.append(sl, sw);
  const cl = document.createElement('p'); cl.className = 'rv-flabel'; cl.textContent = 'Sections'; f.append(cl);
  const grid = document.createElement('div'); grid.className = 'rv-checks';
  const check = (label, get, set, id) => { const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.id = id; c.checked = get(); c.onchange = () => { set(c.checked); saveFmt(); }; l.append(c, document.createTextNode(' ' + label)); return l; };
  SECTIONS.forEach(([k, n]) => grid.append(check(n, () => FMT.sections[k] !== false, v => { FMT.sections[k] = v; }, 'fmt-s-' + k)));
  grid.append(check('Decisions and notes', () => FMT.decisions !== false, v => { FMT.decisions = v; }, 'fmt-dec'));
  f.append(grid);
  return f;
}
function formatted(R) { const out = withDecisions(R); out.format = { title: FMT.title, preparedBy: FMT.preparedBy, preparedFor: FMT.preparedFor, accent: ACCENTS[FMT.accent] ? ACCENTS[FMT.accent][1] : null, sections: FMT.sections, decisions: FMT.decisions !== false }; if (!out.format.decisions) out.items = out.items.map(i => Object.assign({}, i, { decision: undefined, note: undefined })); return out; }

/* drift watch: needs the hosted atlas (same-origin API) */
const API = { ok: false, jev: false };
API.ready = fetch('/api/health').then(r => r.ok ? r.json() : null).then(j => { if (j && j.ok) { API.ok = true; API.jev = !!j.jev; } }).catch(() => {});
function watchPanel() {
  const box = document.createElement('section'); box.className = 'rv-watch';
  const h = document.createElement('h3'); h.textContent = 'Watch for drift'; box.append(h);
  const p = document.createElement('p'); p.className = 'note-line'; box.append(p);
  const web = window.__exports && Object.values(window.__exports).find(d => !/SERVER/i.test(((d.containerVersion || d).container || {}).usageContext || ''));
  if (!API.ok) { p.textContent = 'Drift watch runs on the hosted atlas at atlas.organizedai.vip. Open the audit there to save this container as a baseline and get a daily check of the published version. Drift feeds '; const a0 = document.createElement('a'); a0.href = GTM_AR; a0.target = '_blank'; a0.rel = 'noopener'; a0.textContent = 'GTM Autoresearch'; p.append(a0, document.createTextNode(', which proposes the cleanup.')); return box; }
  if (!web) { p.textContent = 'Drift watch compares a web container with its published version. This audit has no web container.'; return box; }
  const cv = web.containerVersion || web, publicId = (cv.container || {}).publicId;
  const saved = (() => { try { return JSON.parse(localStorage.getItem('atlas-watch:' + publicId) || 'null'); } catch (e) { return null; } })();
  p.textContent = 'Save this export as the baseline. Every day the atlas fetches the published ' + publicId + ' and records what changed: new versions, tags added, removed or paused, firing changes, new server endpoints and measurement IDs. When it drifts, run ';
  const arl = document.createElement('a'); arl.href = GTM_AR; arl.target = '_blank'; arl.rel = 'noopener'; arl.textContent = 'GTM Autoresearch';
  p.append(arl, document.createTextNode(' on the new version: it re-scores the container and proposes the cleanup, one guarded round at a time. The GTM auto tab here runs the same loop, and every round is saved.'));
  const out = document.createElement('div'); out.className = 'rv-wresult';
  const show = (link, res) => {
    out.textContent = '';
    const a = document.createElement('a'); a.href = link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open the drift history'; out.append(a);
    const c = document.createElement('button'); c.type = 'button'; c.className = 'btn ghost'; c.textContent = 'Copy link'; c.onclick = () => { navigator.clipboard.writeText(link).then(() => (c.textContent = 'Copied'), () => (c.textContent = 'Select the link to copy it')); }; out.append(c);
    if (res) { const s = document.createElement('p'); s.className = 'note-line'; s.textContent = res.error ? 'First check failed: ' + res.error : res.changes.length ? 'First check: the published version ' + res.version + ' already differs from this export in ' + res.changes.length + ' ways. They are listed in the history.' : 'First check: the published version ' + res.version + ' matches this export.'; out.append(s); }
  };
  if (saved) show(saved.link);
  const go = document.createElement('button'); go.type = 'button'; go.className = 'btn'; go.textContent = saved ? 'Save a new baseline' : 'Watch ' + publicId;
  go.onclick = async () => {
    go.disabled = true; go.textContent = 'Checking the published container…';
    const names = {}; (cv.tag || []).forEach(t => { names[t.tagId] = t.name; });
    try {
      const r = await fetch('/api/watch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ publicId, label: (cv.container || {}).name, website: window.__report && window.__report.website, baseline: GTM_DRIFT.fromExport(cv), names }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.message || 'The watch could not be saved.');
      try { localStorage.setItem('atlas-watch:' + publicId, JSON.stringify({ link: j.link })); } catch (e) { /* storage blocked */ }
      show(j.link, j.first); go.textContent = 'Watching ' + publicId;
    } catch (e) { go.disabled = false; go.textContent = 'Watch ' + publicId; out.textContent = e.message; }
  };
  box.append(go, out);
  return box;
}

/* GTM auto runs: every round, accepted or rejected, is stored in Cloudflare (D1) when the hosted atlas is in use */
const RUNS = new WeakMap(), GTM_AR = 'https://github.com/Organized-AI/gtm-autoresearch';
function runFor(data, st) {
  let r = RUNS.get(st); if (r) return r;
  r = { queue: Promise.resolve(), saved: 0, failed: 0, id: null, token: null, link: null };
  RUNS.set(st, r);
  if (!API.ok) return r;
  const watch = (() => { try { return JSON.parse(localStorage.getItem('atlas-watch:' + data.publicId) || 'null'); } catch (e) { return null; } })();
  const wid = watch && /[?&]w=([^&]+)/.exec(watch.link || ''); 
  r.queue = fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ publicId: data.publicId, label: data.publicId, website: window.__report && window.__report.website, baselineScore: st.baseline.score, watchId: wid ? wid[1] : null }) })
    .then(res => res.json().then(j => { if (!res.ok) throw new Error(j.message); r.id = j.id; r.token = j.token; r.link = j.link; try { const k = 'atlas-runs:' + data.publicId, l = JSON.parse(localStorage.getItem(k) || '[]'); l.unshift({ link: j.link, at: Date.now() }); localStorage.setItem(k, JSON.stringify(l.slice(0, 20))); } catch (e) { /* storage blocked */ } }))
    .catch(e => { r.error = e.message || 'Could not start the run.'; });
  return r;
}
window.atlasRound = (data, entry, st) => {
  const r = runFor(data, st), body = JSON.stringify({ round: entry.round, accepted: !!entry.accepted, score: entry.score, criticalCount: entry.criticalCount, source: entry.source, idea: entry.idea, why: entry.why, reason: entry.reason, error: entry.error, operations: entry.operations, dimensions: entry.dimensions });
  r.queue = r.queue.then(() => {
    if (!r.id) return;
    return fetch('/api/runs/' + r.id + '/rounds?t=' + encodeURIComponent(r.token), { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      .then(res => { if (res.ok) r.saved++; else r.failed++; }, () => { r.failed++; });
  }).then(() => { const el = document.getElementById('auStore'); if (el) window.atlasRunStatus(st, el); });
};
window.atlasRunStatus = (st, el) => {
  el.textContent = '';
  const r = RUNS.get(st);
  if (!API.ok) { el.append(document.createTextNode('Rounds are saved to Cloudflare on the hosted atlas (atlas.organizedai.vip). Here they stay in this page.')); return; }
  if (!r) { el.append(document.createTextNode('Every round you run, accepted or rejected, is saved to Cloudflare with its operations and scores.')); return; }
  if (r.error) { el.append(document.createTextNode('Rounds are not being saved: ' + r.error)); return; }
  el.append(document.createTextNode(r.saved + ' round' + (r.saved === 1 ? '' : 's') + ' saved to Cloudflare' + (r.failed ? ', ' + r.failed + ' failed' : '') + '. '));
  if (r.link) { const a = document.createElement('a'); a.href = r.link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open the run history'; el.append(a); }
};

/* Jev: hosted on this atlas's own Worker (Workers AI). It reviews every finding as soon as the audit is built;
   the person still decides, and can accept the confident suggestions in one click. */
const TO_DEC = { fix: 'fix', intended: 'keep', ask_owner: 'ask' };
const JEV = { done: false, running: false, results: 0 };
function jevNormalize(key, p) {
  const k = ['fix', 'intended', 'ask_owner'], v = k.map(x => Math.max(0, Number(p[x]) || 0)), s = v.reduce((a, b) => a + b, 0) || 1, probs = {};
  k.forEach((x, i) => { probs[x] = v[i] / s; });
  const top = k.reduce((a, b) => (probs[a] >= probs[b] ? a : b));
  return { key, probabilities: probs, choice: top, decision: TO_DEC[top], confidence: (3 * probs[top] - 1) / 2 };
}
async function jevRun(items) {
  // Short ids keep the model from mangling long finding keys; results are mapped back by id.
  const byId = {}, findings = items.map((f, i) => { const id = 'f' + (i + 1); byId[id] = f.key; return Object.assign({}, f, { key: id }); });
  const r = await fetch('/api/judge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ findings }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || 'Jev could not answer.');
  return j.results.filter(x => byId[x.key]).map(x => jevNormalize(byId[x.key], x.probabilities));
}
function jevChip(el, r) {
  const slot = el.jevSlot; slot.textContent = ''; slot.hidden = false;
  const strong = r.confidence >= 0.75, weak = r.confidence < 0.40;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'rv-jevbtn' + (strong ? ' strong' : weak ? ' weak' : '');
  b.textContent = 'Jev: ' + DEC[r.decision] + ' · ' + Math.round(r.probabilities[r.choice] * 100) + '%';
  b.title = 'fix ' + Math.round(r.probabilities.fix * 100) + '% · intended ' + Math.round(r.probabilities.intended * 100) + '% · ask owner ' + Math.round(r.probabilities.ask_owner * 100) + '%. Click to accept.';
  b.onclick = () => el.decide(r.decision, false);
  const n = document.createElement('span'); n.textContent = strong ? 'confident' : weak ? 'unsure, ask a person' : 'leaning';
  slot.append(b, n);
}
function paintJev() { document.querySelectorAll('.rv-item').forEach(el => { if (RV.jev[el.dataset.key]) jevChip(el, RV.jev[el.dataset.key]); }); }
function jevSummary() {
  const all = Object.values(RV.jev), confident = all.filter(r => r.confidence >= 0.75), open = confident.filter(r => !RV.dec[r.key]);
  $('jevStatus').textContent = all.length ? `Reviewed ${all.length} of ${RV.total} findings · ${confident.length} confident` : 'Ready';
  const acc = $('jevAccept'); acc.hidden = !open.length; acc.textContent = 'Accept ' + open.length + ' confident suggestion' + (open.length === 1 ? '' : 's');
}
async function jevAll() {
  if (JEV.running) return; JEV.running = true;
  const msg = $('jevMsg'), todo = RV.list.flatMap(c => c.items).filter(i => !RV.jev[i.key]);
  const batches = []; for (let i = 0; i < todo.length; i += 8) batches.push(todo.slice(i, i + 8));
  let failed = 0, next = 0;
  $('jevRun').hidden = true;
  const progress = () => { const n = Object.keys(RV.jev).length; $('jevStatus').textContent = 'Reviewing findings · ' + n + ' of ' + RV.total + ' done…'; };
  progress();
  // Three batches at a time; a failed batch is retried once.
  const worker = async () => {
    while (next < batches.length) {
      const b = batches[next++];
      let res = null;
      for (let attempt = 0; attempt < 2 && !res; attempt++) { try { res = await jevRun(b); } catch (e) { if (attempt) failed += b.length; } }
      if (res) { res.forEach(r => { RV.jev[r.key] = r; }); paintJev(); progress(); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const missing = RV.list.flatMap(c => c.items).filter(i => !RV.jev[i.key]).length;
  msg.textContent = missing ? missing + ' findings got no suggestion. Ask Jev again to retry them.' : 'Each finding has a suggestion: fix, intended or ask the owner, with Jev\'s confidence. Click one to accept it, or accept every confident one at once.';
  if (missing) { $('jevRun').hidden = false; $('jevRun').textContent = 'Ask Jev again'; }
  JEV.running = false; jevSummary();
}
async function jevBar() {
  const bar = $('rvJev'); if (!bar) return;
  if (!bar.dataset.wired) {
    bar.dataset.wired = '1';
    $('jevRun').onclick = jevAll;
    $('jevAccept').onclick = () => {
      Object.values(RV.jev).filter(r => r.confidence >= 0.75 && !RV.dec[r.key]).forEach(r => { RV.dec[r.key] = { d: r.decision, note: '', jev: r.confidence }; });
      persist(); go(RV.cp); jevSummary();
    };
  }
  await API.ready;
  if (!API.jev) { bar.hidden = true; return; }
  bar.hidden = false; jevSummary();
  if (!JEV.done) { JEV.done = true; jevAll(); }
}

/* reports */
let dl;
async function save(filename, data, msg) {
  const say = t => { msg.textContent = t; };
  try {
    if (dl === undefined) dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    if (dl) { await dl.save({ filename, data }); return say('Saved ' + filename + '.'); }
    const blob = data instanceof Blob ? data : new Blob([data]), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say('Downloaded ' + filename + '.');
  } catch (e) { say(e && e.code === 'declined' ? 'Save cancelled.' : e && e.code === 'rate_limited' ? 'A save prompt is already open.' : 'This view cannot save files. Open the page in a browser or in Claude.'); }
}
function withDecisions(R) {
  const out = Object.assign({}, R);
  out.items = R.items.map(i => { const d = RV.dec[i.key]; return d ? Object.assign({}, i, { decision: d.d, note: d.note || '' }) : i; });
  return out;
}
/* PDF preview: pages are drawn with pdf.js (loaded on first use) so the preview looks the same in a browser, on a phone and inside Claude. */
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
let pdfjsReady = null;
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.append(s); }); }
function pdfjs() {
  // The worker script is loaded as a plain script so pdf.js runs it on the page; no cross-origin worker is needed.
  if (!pdfjsReady) pdfjsReady = loadScript(PDFJS + 'pdf.min.js').then(() => loadScript(PDFJS + 'pdf.worker.min.js')).then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; return window.pdfjsLib; });
  return pdfjsReady;
}
function buildPdf(R) {
  if (!window.jspdf) throw new Error('The PDF library did not load. Download the Markdown report instead.');
  return GTM_REPORT.pdf(formatted(R), window.jspdf.jsPDF);
}
let pvFocus = null;
async function preview(R) {
  const pv = $('pv'), pages = $('pvPages'), msg = $('pvMsg'), base = GTM_REPORT.fileBase(R);
  pvFocus = document.activeElement; pv.hidden = false; pages.textContent = ''; msg.textContent = 'Building the report…';
  $('pvTitle').textContent = (FMT.title || 'GTM container audit') + (R.website ? ' · ' + R.website : '');
  $('pvClose').focus();
  let buf;
  try { buf = buildPdf(R); } catch (e) { msg.textContent = e.message; return; }
  const bytes = new Uint8Array(buf);
  $('pvDownload').onclick = () => save(base + '.pdf', new Blob([bytes], { type: 'application/pdf' }), msg);
  try {
    const lib = await pdfjs(), doc = await lib.getDocument({ data: bytes.slice() }).promise;
    $('pvMeta').textContent = doc.numPages + ' pages · letter · ' + base + '.pdf';
    msg.textContent = '';
    const width = Math.min(820, pages.clientWidth - 32), ratio = Math.min(2, window.devicePixelRatio || 1);
    for (let i = 1; i <= doc.numPages; i++) {
      if (pv.hidden) return;
      const page = await doc.getPage(i), vp1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: (width / vp1.width) * ratio });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.setAttribute('aria-label', 'Page ' + i + ' of ' + doc.numPages);
      pages.append(c); const n = document.createElement('p'); n.className = 'pv-num'; n.textContent = i + ' / ' + doc.numPages; pages.append(n);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
  } catch (e) {
    // pdf.js unavailable: fall back to the browser's own PDF viewer where it can show one.
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), f = document.createElement('iframe');
    f.src = url; f.title = 'Report preview'; pages.textContent = ''; pages.append(f);
    msg.textContent = 'Showing the browser\'s PDF viewer. If it stays blank, use Download now.';
  }
}
function closePreview() { $('pv').hidden = true; $('pvPages').textContent = ''; if (pvFocus && pvFocus.focus) pvFocus.focus(); }
function reportBar(R) {
  const msg = $('rmsg'), base = GTM_REPORT.fileBase(R);
  $('previewBtn').onclick = () => preview(R);
  $('pvClose').onclick = closePreview;
  $('pvFormat').onclick = () => { closePreview(); openReview(true); go(RV.list.length - 1); const f = document.querySelector('.rv-format'); if (f) f.scrollIntoView({ block: 'start' }); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('pv').hidden) { e.stopPropagation(); closePreview(); } }, true);
  $('pdfBtn').onclick = () => {
    try { save(base + '.pdf', new Blob([buildPdf(R)], { type: 'application/pdf' }), msg); }
    catch (e) { msg.textContent = 'The PDF could not be built: ' + e.message; }
  };
  $('mdBtn').onclick = () => save(base + '.md', GTM_REPORT.markdown(formatted(R)), msg);
  $('reviewBtn').onclick = () => openReview(true);
  $('newBtn').onclick = () => location.reload();
}
})();
