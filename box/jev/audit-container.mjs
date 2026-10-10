// audit-container.mjs - illustration for the guide "How Jev reads a GTM container", section 14.
// Deterministic code only: one container version in, one audit report (JSON) out. No model call.
// Run: node audit-container.mjs audit-web.json > audit-web-report.json
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const REF = /\{\{([^}]+)\}\}/g;
const cv = JSON.parse(readFileSync(process.argv[2], 'utf8')).containerVersion;
const ctx = String((cv.container?.usageContext || ['WEB'])[0]).toLowerCase();
const tags = cv.tag || [], triggers = cv.trigger || [], variables = cv.variable || [];
const clients = cv.client || [], transformations = cv.transformation || [];
const builtIns = new Set((cv.builtInVariable || []).map(b => b.name).concat(['_event']));

const strings = (v, a = []) => (typeof v === 'string' ? a.push(v) : Array.isArray(v) ? v.forEach(x => strings(x, a)) : v && typeof v === 'object' && Object.values(v).forEach(x => strings(x, a)), a);
const refsIn = e => strings([e.parameter, e.filter, e.customEventFilter, e.autoEventFilter]).flatMap(s => [...s.matchAll(REF)].map(m => m[1]));
const varNames = new Set(variables.map(v => v.name));
const trigIds = new Set(triggers.map(t => t.triggerId));

const findings = [];
const add = (check, severity, entity, evidence, hard_stop = false) => findings.push({ check, severity, entity, evidence, hard_stop });

// Integrity
for (const [kind, list] of [['tag', tags], ['trigger', triggers], ['variable', variables]])
  for (const e of list) for (const name of refsIn(e))
    if (!varNames.has(name) && !builtIns.has(name)) add('AUD-REF-01', 'critical', `${kind}:${e.name}`, `references undefined variable {{${name}}}`, true);
for (const t of tags) for (const id of [...(t.firingTriggerId || []), ...(t.blockingTriggerId || [])])
  if (!trigIds.has(id)) add('AUD-REF-01', 'critical', `tag:${t.name}`, `references missing trigger ID ${id}`, true);

// Opaque code
for (const t of tags) if (t.type === 'html') add('AUD-OPQ-01', 'high', `tag:${t.name}`, 'custom HTML tag: arbitrary code Jev cannot judge', true);
for (const v of variables) if (v.type === 'jsm') add('AUD-OPQ-01', 'high', `variable:${v.name}`, 'custom JavaScript variable', true);
for (const c of cv.customTemplate || []) add('AUD-OPQ-01', 'high', `customTemplate:${c.name}`, 'sandboxed template code', true);

// Consent
for (const t of tags) {
  const cs = t.consentSettings || {};
  const types = (cs.consentType?.list || []).map(x => x.value);
  if (!cs.consentStatus || String(cs.consentStatus).toUpperCase() === 'NOT_SET') add('AUD-CON-01', 'medium', `tag:${t.name}`, 'no consent setting on the tag');
  else if (String(cs.consentStatus).toUpperCase() === 'NEEDED' && !types.length) add('AUD-CON-02', 'high', `tag:${t.name}`, 'consent is NEEDED but no consent types are listed');
}

// Tags and triggers
const used = new Set(tags.flatMap(t => [...(t.firingTriggerId || []), ...(t.blockingTriggerId || [])]));
for (const t of tags) {
  if (!(t.firingTriggerId || []).length) add('AUD-TRG-01', 'medium', `tag:${t.name}`, 'no firing trigger');
  if (t.paused) add('AUD-TAG-01', 'low', `tag:${t.name}`, 'paused tag still in the container');
  if (t.liveOnly) add('AUD-TAG-02', 'info', `tag:${t.name}`, 'liveOnly: Preview cannot observe this tag');
}
for (const t of triggers) if (!used.has(t.triggerId)) add('AUD-TRG-02', 'low', `trigger:${t.name}`, 'trigger is not used by any tag');
const usedVars = new Set([...tags, ...triggers, ...variables].flatMap(refsIn));
for (const v of variables) if (!usedVars.has(v.name)) add('AUD-VAR-01', 'low', `variable:${v.name}`, 'variable is not referenced anywhere');

// Server only
if (ctx === 'server') {
  if (!clients.length) add('AUD-SRV-01', 'high', 'container', 'server container has no client, so no request can be claimed');
  const byPri = {};
  for (const c of clients) (byPri[c.priority ?? 0] ||= []).push(c.name);
  for (const [p, names] of Object.entries(byPri)) if (names.length > 1) add('AUD-SRV-02', 'medium', `client:${names.join(' + ')}`, `clients share priority ${p}; claim order is not explicit`);
}

const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.check.localeCompare(b.check));
findings.forEach((f, i) => (f.id = `F${String(i + 1).padStart(2, '0')}`));
const counts = Object.fromEntries(Object.keys(rank).map(s => [s, findings.filter(f => f.severity === s).length]));
const report = {
  report_version: '1',
  container: { usage_context: ctx, container_id: cv.containerId, version_id: cv.containerVersionId, google_fingerprint: cv.fingerprint,
    entities: { tags: tags.length, triggers: triggers.length, variables: variables.length, clients: clients.length, transformations: transformations.length } },
  digest: 'sha256:' + createHash('sha256').update(JSON.stringify(cv)).digest('hex').slice(0, 16),
  jev_lane: { run: false, note: 'No Jev call was made. Judgment questions are listed in the report as not run.' },
  counts, hard_stops: findings.filter(f => f.hard_stop).map(f => f.id), findings,
};
console.log(JSON.stringify(report, null, 2));
