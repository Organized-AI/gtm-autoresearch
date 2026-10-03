// read-container.mjs - illustration for the guide "How Jev reads a GTM container".
// Deterministic code only: parse, resolve references, canonicalize, diff, blast radius, probe.
// No model call. Run: node read-container.mjs before.json after-a.json
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const KINDS = { tag: 'tagId', trigger: 'triggerId', variable: 'variableId', folder: 'folderId' };
const VOLATILE = new Set(['fingerprint', 'tagManagerUrl', 'path', 'workspaceId', 'accountId', 'containerId']);
const SAMPLE_PATHS = ['/', '/cart', '/checkout', '/checkout/shipping', '/checkout/thank-you', '/help/checkout-faq'];

const load = f => JSON.parse(readFileSync(f, 'utf8')).containerVersion;

// 1. Canonical form: drop volatile keys, sort map keys, treat ID arrays as sets.
const SET_KEYS = new Set(['firingTriggerId', 'blockingTriggerId', 'enablingTriggerId', 'disablingTriggerId']);
function canon(v, key) {
  if (Array.isArray(v)) {
    const out = v.map(x => canon(x));
    return SET_KEYS.has(key) ? out.sort() : out;
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).filter(k => !VOLATILE.has(k)).sort().map(k => [k, canon(v[k], k)]));
  }
  return v;
}
const sha = o => 'sha256:' + createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

function index(cv) {
  const idx = {};
  for (const [kind, idKey] of Object.entries(KINDS)) {
    idx[kind] = Object.fromEntries((cv[kind] || []).map(e => [e[idKey], canon(e)]));
  }
  idx.builtIn = (cv.builtInVariable || []).map(b => b.name);
  return idx;
}

// 2. References: {{Name}} by name, trigger/folder by ID.
const REF = /\{\{([^}]+)\}\}/g;
function strings(v, acc = []) {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) v.forEach(x => strings(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, acc));
  return acc;
}
function refs(idx) {
  const varNames = new Set(Object.values(idx.variable).map(v => v.name));
  const builtIns = new Set([...idx.builtIn, ...(idx.builtIn.includes('Event') ? ['_event'] : [])]);
  const edges = [], unresolved = [];
  const add = (from, to, via) => edges.push({ from, to, via });
  for (const kind of ['tag', 'trigger', 'variable']) {
    for (const [id, e] of Object.entries(idx[kind])) {
      const from = `${kind}:${e.name}`;
      for (const s of strings({ parameter: e.parameter, filter: e.filter, customEventFilter: e.customEventFilter, autoEventFilter: e.autoEventFilter })) {
        for (const m of s.matchAll(REF)) {
          const name = m[1];
          if (varNames.has(name)) add(from, `variable:${name}`, 'name');
          else if (builtIns.has(name)) add(from, `builtin:${name}`, 'name');
          else unresolved.push({ from, ref: `{{${name}}}`, kind: 'variable' });
        }
      }
      for (const key of ['firingTriggerId', 'blockingTriggerId']) {
        for (const t of e[key] || []) {
          if (idx.trigger[t]) add(from, `trigger:${idx.trigger[t].name}`, key);
          else unresolved.push({ from, ref: `${key}:${t}`, kind: 'trigger' });
        }
      }
      if (e.parentFolderId && !idx.folder[e.parentFolderId]) unresolved.push({ from, ref: `parentFolderId:${e.parentFolderId}`, kind: 'folder' });
    }
  }
  return { edges, unresolved };
}

// 3. Diff by kind + ID (same container, two versions). Field paths come from a flat walk.
function flat(v, p = '', out = {}) {
  if (v && typeof v === 'object') for (const k of Object.keys(v)) flat(v[k], p ? `${p}.${k}` : k, out);
  else out[p] = v;
  return out;
}
function diff(a, b) {
  const d = { added: [], removed: [], changed: [] };
  for (const kind of Object.keys(KINDS)) {
    const ids = new Set([...Object.keys(a[kind]), ...Object.keys(b[kind])]);
    for (const id of ids) {
      const x = a[kind][id], y = b[kind][id];
      if (!x) d.added.push(`${kind}:${y.name}`);
      else if (!y) d.removed.push(`${kind}:${x.name}`);
      else if (sha(x) !== sha(y)) {
        const fx = flat(x), fy = flat(y);
        const fields = [...new Set([...Object.keys(fx), ...Object.keys(fy)])].filter(k => fx[k] !== fy[k]);
        d.changed.push({ entity: `${kind}:${y.name}`, fields });
      }
    }
  }
  return d;
}

// 4. Blast radius: walk the reverse edges from every touched entity.
function blast(touched, edges) {
  const hit = new Set(touched);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of edges) if (hit.has(e.to) && !hit.has(e.from)) { hit.add(e.from); grew = true; }
  }
  return [...hit].filter(x => !touched.includes(x) && (x.startsWith('tag:') || x.startsWith('trigger:')));
}

// 5. Probe: evaluate path conditions on a closed sample list so a model never has to guess regex behavior.
const OPS = {
  EQUALS: (v, p) => v === p, CONTAINS: (v, p) => v.includes(p), STARTS_WITH: (v, p) => v.startsWith(p),
  ENDS_WITH: (v, p) => v.endsWith(p), MATCH_REGEX: (v, p) => new RegExp(p).test(v),
};
function pathMatches(trigger) {
  const c = (trigger.filter || [])[0];
  if (!c) return null;
  const arg = k => (c.parameter.find(p => p.key === k) || {}).value;
  if (arg('arg0') !== '{{Page Path}}' || !OPS[c.type]) return null;
  return SAMPLE_PATHS.filter(p => OPS[c.type](p, arg('arg1')));
}

const [fa, fb] = process.argv.slice(2);
const A = load(fa), B = load(fb), ia = index(A), ib = index(B);
const rb = refs(ib), d = diff(ia, ib);
const touched = [...d.added, ...d.removed, ...d.changed.map(c => c.entity)];
const probes = d.changed.filter(c => c.entity.startsWith('trigger:')).map(c => {
  const id = Object.keys(ib.trigger).find(k => ib.trigger[k].name === c.entity.slice(8));
  return { trigger: c.entity, before_matches: pathMatches(ia.trigger[id]), after_matches: pathMatches(ib.trigger[id]) };
});
const consentTouched = d.changed.some(c => c.fields.some(f => f.startsWith('consentSettings')));
const state = {
  before: sha(ia), after: sha(ib),
  version_fingerprint: { before: A.fingerprint, after: B.fingerprint },
  diff: d,
  blast_radius: blast(touched, rb.edges),
  unresolved_refs: rb.unresolved,
  probes,
  consent_touched: consentTouched,
};
console.log(JSON.stringify(state, null, 2));
