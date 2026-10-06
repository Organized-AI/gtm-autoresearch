// Upload ↔ proposed sheet. Builds the proposal from the current report and review
// decisions each time it opens, then renders both containers line by line.
(() => {
'use strict';
const $ = id => document.getElementById(id);
const CV = { P: null, i: 0, blocks: null };
const SRC = { decision: 'your decision', default: 'by default', tidy: 'GTM auto' };
const VERB = { remove: 'removed', add: 'added', edit: 'edited', merge: 'merged', pause: 'paused', folder: 'filed', resolved: 'no change' };
const motion = () => window.gsap && !matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = (tag, cls, text, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.append(e); return e; };

function compute() {
  CV.P = GTM_PROPOSE.build({ engine: GTM_ENGINE, auto: GTM_AUTO, report: window.__report, exports: window.__exports || {},
    decisions: window.__atlasDecisions ? window.__atlasDecisions() : {}, website: window.__atlasSite || window.__report.website });
  CV.i = Math.min(CV.i, CV.P.containers.length - 1);
}

function tabs() {
  const t = $('cmpTabs'); t.textContent = '';
  if (CV.P.containers.length < 2) return;
  CV.P.containers.forEach((c, i) => {
    const b = el('button', '', c.publicId + ' · ' + c.context, t); b.type = 'button'; b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === CV.i)); b.onclick = () => { CV.i = i; render(); };
  });
}

function stat(label, before, after, note, better) {
  const s = el('div', 'cmp-stat' + (better ? ' up' : ''));
  el('span', '', label, s);
  const b = el('b', '', null, s); el('s', '', String(before), b); b.append(' → '); const em = el('em', '', String(after), b); em.dataset.to = after;
  if (note) el('small', '', note, s);
  return s;
}
function scores(c) {
  const box = $('cmpScores'); box.textContent = '';
  const applied = c.changes.filter(x => x.action !== 'resolved').length, owner = ownerList(c).length;
  box.append(
    stat('Configuration score', c.scoreBefore, c.scoreAfter, 'same checks, run on both files', c.scoreAfter > c.scoreBefore),
    stat('Fix first', c.critBefore, c.critAfter, 'critical findings', c.critAfter < c.critBefore),
    stat('To confirm', c.reviewBefore, c.reviewAfter, 'findings to review', c.reviewAfter < c.reviewBefore),
  );
  const s = el('div', 'cmp-stat', null, box); el('span', '', 'Changes in the proposal', s);
  const b = el('b', '', null, s); const em = el('em', '', String(applied), b); em.dataset.to = applied;
  el('small', '', owner + ' finding' + (owner === 1 ? '' : 's') + ' left for the owner', s);
  if (motion()) box.querySelectorAll('em').forEach(e => { const o = { v: 0 }, to = +e.dataset.to; gsap.to(o, { v: to, duration: .9, ease: 'power2.out', onUpdate: () => { e.textContent = Math.round(o.v); } }); });
}

function rail(c) {
  const list = $('cmpChanges'); list.textContent = '';
  const real = c.changes.filter(x => x.action !== 'resolved'), quiet = c.changes.filter(x => x.action === 'resolved');
  $('cmpCount').textContent = real.length + (quiet.length ? ' · ' + quiet.length + ' already handled' : '');
  real.concat(quiet).forEach(x => {
    const li = el('li', 'cmp-ch a-' + x.action, null, list); li.tabIndex = x.action === 'resolved' ? -1 : 0;
    el('span', 'src', SRC[x.source] || '', li);
    const b = el('b', '', null, li); el('span', 'tag', VERB[x.action] || x.action, b); b.append(x.name);
    el('p', '', x.what, li);
    if (x.source !== 'tidy') el('p', 'why', x.check + ': ' + x.why, li); else el('p', 'why', x.why, li);
    if (x.action !== 'resolved') { li.onclick = () => jump(x); li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(x); } }; }
  });
  const ow = $('cmpOwner'); ow.textContent = '';
  const all = ownerList(c);
  $('cmpOwnerCount').textContent = String(all.length);
  all.forEach(o => { const li = el('li', 'cmp-ow', null, ow); el('b', '', o.item.name, li); el('p', '', o.reason, li); el('i', '', o.item.check + ' · ' + o.item.message, li); });
  if (!all.length) el('li', 'cmp-ow', 'Nothing. Every finding was fixed or marked intended.', ow);
}

function ownerList(c) { return CV.P.owner.filter(o => o.item.container === c.publicId || o.item.context === 'flow' || o.item.check === 'Site scan'); }
function block(kind, ref) { return CV.blocks && CV.blocks.find(b => b.kind === kind && b.ref === String(ref)); }
function target(x) {
  const quoted = [...x.what.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  if (x.action === 'folder') return block('folder', x.ref);
  const own = block(x.kind, x.ref);
  if (own && own.status !== 'same') return own;
  return CV.blocks.find(b => b.status !== 'same' && quoted.includes(b.name)) || own;
}
function jump(x) {
  const b = target(x); if (!b) return;
  if (b.status === 'same' && $('cmpOnly').checked) { $('cmpOnly').checked = false; grid(); }
  const node = document.getElementById(b.id); if (!node) return;
  const sc = $('cmpScroll');
  sc.scrollTo({ top: node.offsetTop, behavior: motion() ? 'smooth' : 'auto' });
  node.classList.remove('flash'); void node.offsetWidth; node.classList.add('flash');
}

function grid() {
  const g = $('cmpGrid'), only = $('cmpOnly').checked; g.textContent = '';
  let ln = 0, rn = 0, folded = 0;
  const frag = document.createDocumentFragment();
  const flush = () => { if (!folded) return; const f = el('div', 'cmp-fold', folded + ' unchanged element' + (folded > 1 ? 's' : ''), frag); const b = el('button', '', 'Show', f); b.type = 'button'; b.onclick = () => { $('cmpOnly').checked = false; grid(); }; folded = 0; };
  CV.blocks.forEach((b, k) => {
    b.id = 'cmp-el-' + k;
    if (only && b.status === 'same') { ln += b.rows.length; rn += b.rows.length; folded++; return; }
    flush();
    const h = el('div', 'cmp-el', null, frag); h.id = b.id;
    el('span', 'st ' + b.status, b.status, h); el('span', 'k ' + b.kind, b.kind + ' ' + b.ref, h); el('b', '', b.name, h);
    if (b.paused.after && !b.paused.before) el('span', 'st changed', 'paused', h);
    b.rows.forEach(([t, l, r]) => {
      const cl = t === 'same' ? '' : t;
      el('div', 'ln ' + (l == null ? 'gap' : cl), l == null ? '' : String(++ln), frag);
      el('div', 'tx ' + (l == null ? 'gap' : cl), l == null ? '' : l, frag);
      el('div', 'ln r ' + (r == null ? 'gap' : cl), r == null ? '' : String(++rn), frag);
      el('div', 'tx ' + (r == null ? 'gap' : cl), r == null ? '' : r, frag);
    });
  });
  flush();
  if (!frag.childNodes.length) el('div', 'cmp-empty', 'No changes for this container.', frag);
  g.append(frag);
}

function render() {
  const c = CV.P.containers[CV.i]; if (!c) return;
  tabs(); scores(c); rail(c);
  CV.blocks = GTM_PROPOSE.diff(c.before, c.after);
  const changed = CV.blocks.filter(b => b.status !== 'same').length;
  const cvB = c.before.containerVersion || c.before;
  $('cmpUpMeta').textContent = c.publicId + (cvB.containerVersionId ? ' · version ' + cvB.containerVersionId : '') + (c.before.exportTime ? ' · exported ' + c.before.exportTime : '');
  $('cmpPrMeta').textContent = changed + ' of ' + CV.blocks.length + ' elements differ · not published';
  $('cmpScroll').scrollTop = 0; grid();
  if (motion()) gsap.fromTo('#cmpGrid .cmp-el', { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: .3, stagger: .015, ease: 'power2.out' });
}

function open() {
  if (!window.__report) return;
  try { compute(); } catch (e) { console.error(e); return; }
  if (!CV.P.containers.length) return;
  const sheet = $('compare'); sheet.hidden = false; document.body.style.overflow = 'hidden';
  render();
  if (motion()) { gsap.fromTo(sheet, { opacity: 0 }, { opacity: 1, duration: .3 }); gsap.fromTo('.cmp-head', { y: -6, opacity: 0 }, { y: 0, opacity: 1, stagger: .12, duration: .4, delay: .1 }); }
  $('cmpClose').focus({ preventScroll: true });
}
function close() {
  $('compare').hidden = true; document.body.style.overflow = '';
  const b = $('cmpBtn'); if (b) b.focus({ preventScroll: true });
  window.dispatchEvent(new Event('resize'));
}

function say(t) { $('cmpMsg').textContent = t; }
$('cmpClose').onclick = close;
$('cmpOnly').onchange = grid;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('compare').hidden) close(); });
$('cmpDownload').onclick = () => {
  const c = CV.P.containers[CV.i];
  const url = URL.createObjectURL(new Blob([JSON.stringify(c.after, null, 2)], { type: 'application/json' }));
  const a = el('a'); a.href = url; a.download = c.publicId + '_proposed.json'; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  say('Downloaded ' + a.download + '. Import it into a new workspace in GTM (Admin → Import Container → Merge) and review before publishing.');
};
$('cmpCopy').onclick = async () => {
  const md = GTM_PROPOSE.markdown(CV.P);
  try { await navigator.clipboard.writeText(md); say('Change log copied as Markdown.'); }
  catch (e) { const t = el('textarea'); t.value = md; document.body.append(t); t.select(); try { document.execCommand('copy'); say('Change log copied as Markdown.'); } catch (x) { say('Copy was blocked by the browser.'); } t.remove(); }
};
window.atlasCompare = { open, close };
})();
