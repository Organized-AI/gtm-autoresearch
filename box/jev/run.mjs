// Runs the Jev container guide's own deterministic scripts against this repo's
// containers. The scripts in this folder are copied unchanged from
// https://guide.organizedai.vip/jev-container-json/ (see SOURCE.md); this file
// only calls them and filters one known false positive.
//
// Known false positive: GTM built-in triggers (All Pages = 2147479553,
// Initialization - All Pages = 2147479573, Consent Initialization = 2147479572)
// never appear in an export, so the guide's reader reports every reference to
// them as unresolved. The guide's own failure table names this ("built-in
// variables flagged as missing"). We count them separately instead of dropping them.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { p } from "../checks/repo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILTIN_TRIGGER = /\b2147479\d{3}\b/;

function node(script, ...files) {
  const r = spawnSync(process.execPath, [join(HERE, script), ...files.map((f) => p(f))], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${script}: ${(r.stderr || "").trim().split("\n").pop()}`);
  return JSON.parse(r.stdout);
}

// Seed -> winner: diff, blast radius, consent_touched, unresolved refs.
export function readDiff(before, after) {
  const s = node("read-container.mjs", before, after);
  const builtin = s.unresolved_refs.filter((u) => BUILTIN_TRIGGER.test(u.ref));
  const real = s.unresolved_refs.filter((u) => !BUILTIN_TRIGGER.test(u.ref));
  return { ...s, unresolved_refs: real, builtin_refs_flagged: builtin.length };
}

// One container -> audit findings with code-set severities and hard stops.
export function audit(file) {
  const r = node("audit-container.mjs", file);
  const builtin = r.findings.filter((f) => f.check === "AUD-REF-01" && BUILTIN_TRIGGER.test(f.evidence));
  const findings = r.findings.filter((f) => !builtin.includes(f));
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byCheck = {};
  for (const f of findings) { counts[f.severity]++; byCheck[f.check] = (byCheck[f.check] || 0) + 1; }
  return { ...r, findings, counts, byCheck, hard_stops: findings.filter((f) => f.hard_stop).map((f) => f.id), builtin_refs_flagged: builtin.length };
}

// Which changed entities are opaque code (custom HTML / custom JS), from the winner.
export function opaqueTouched(diffState, winnerFile, readJson) {
  const cv = (readJson(winnerFile).containerVersion) || {};
  const opaque = new Set([
    ...(cv.tag || []).filter((t) => t.type === "html").map((t) => `tag:${t.name}`),
    ...(cv.variable || []).filter((v) => v.type === "jsm").map((v) => `variable:${v.name}`),
  ]);
  const touched = [...diffState.diff.changed.map((c) => c.entity), ...diffState.diff.added].filter((e) => opaque.has(e));
  return touched;
}
