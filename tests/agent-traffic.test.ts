import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateGtmSignalQuality, scoreAgentTraffic, AGENT_TRAFFIC_WEIGHT, type GtmContainer } from "../evals/eval_gtm_signal_quality.ts";

const seed = (): GtmContainer => JSON.parse(readFileSync("content/gtm-templates/HRE/seed/shopify-ecom-web.json", "utf8"));
const frag = JSON.parse(readFileSync("box/templates/agent-traffic/gtm-fragment.json", "utf8"));

function withFragment(c: GtmContainer): GtmContainer {
  const cv = c.containerVersion;
  let id = 9000;
  cv.variable = [...(cv.variable ?? []), ...frag.variables.map((v: any) => ({ ...v, variableId: String(id++), accountId: cv.variable?.[0]?.accountId, containerId: cv.variable?.[0]?.containerId }))];
  const g = cv.tag!.find((t) => t.type === "googtag")!;
  const table = g.parameter!.find((p) => p.key === "configSettingsTable")!;
  table.list = [...(table.list ?? []), ...frag.googleTagConfigRows];
  return c;
}

test("agent traffic is opt-in: default scores are unchanged", () => {
  const a = evaluateGtmSignalQuality(seed());
  assert.ok(!a.dimensions.some((d) => d.name === "agentTraffic"));
  const b = evaluateGtmSignalQuality(seed(), undefined, { agentTraffic: true });
  assert.equal(b.dimensions.length, a.dimensions.length + 1);
  const sum = b.dimensions.reduce((s, d) => s + d.weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, `weights sum to ${sum}`);
  assert.equal(b.dimensions.find((d) => d.name === "agentTraffic")!.weight, AGENT_TRAFFIC_WEIGHT);
});

test("a container with no agent signals scores 0 and gets fixable warnings", () => {
  const cv = seed().containerVersion;
  const d = scoreAgentTraffic(cv.tag ?? [], cv.variable ?? []);
  assert.equal(d.score, 0);
  assert.equal(d.issues.filter((i) => i.severity === "warning").length, 6);
});

test("the reference fragment scores 1.0 and adds no custom code", () => {
  const c = withFragment(seed());
  const d = scoreAgentTraffic(c.containerVersion.tag ?? [], c.containerVersion.variable ?? []);
  assert.equal(d.score, 1);
  assert.ok(!frag.variables.some((v: any) => v.type === "jsm" || v.type === "html"));
  const before = evaluateGtmSignalQuality(seed(), undefined, { agentTraffic: true }).combinedScore;
  const after = evaluateGtmSignalQuality(c, undefined, { agentTraffic: true }).combinedScore;
  assert.ok(after > before, `${after} > ${before}`);
});

test("partial work earns partial credit, so the loop can build it a few entities per round", () => {
  const c = seed();
  c.containerVersion.variable = [...(c.containerVersion.variable ?? []), { ...frag.variables[0], variableId: "9000" }];
  const d = scoreAgentTraffic(c.containerVersion.tag ?? [], c.containerVersion.variable ?? []);
  assert.equal(d.score, 0.2);
});

test("the recipe builds on BLADE's best container in 4 valid rounds of at most 3 edits, each raising the score", async () => {
  const { applyOperations, validateCandidate, assertValidOperations } = await import("../scripts/gtm-container-mutations.ts");
  let c: GtmContainer = JSON.parse(readFileSync("content/gtm-templates/BLADE/winning/2026-04-29T143650-blade-web.json", "utf8"));
  const snap = JSON.parse(readFileSync("data/signals/blade-ads-snapshot-enriched.json", "utf8"));
  const v = (name: string) => frag.variables.find((x: any) => x.name === name);
  const g = c.containerVersion.tag!.find((t) => t.type === "googtag" && /CONFIG/i.test(t.name))!;
  const row = (i: number) => frag.googleTagConfigRows[i];
  const cfg = (rows: any[]) => ({ op: "modify_tag", tagId: g.tagId, changes: { parameter: [...(g.parameter ?? []).filter((p) => p.key !== "configSettingsTable"), { type: "LIST", key: "configSettingsTable", list: rows }] } });
  const rounds = [
    [{ op: "add_variable", entity: v("JS - Navigator WebDriver") }, { op: "add_variable", entity: v("JS - User Agent") }, { op: "add_variable", entity: v("RT - Agent UA Class") }],
    [{ op: "add_variable", entity: v("LT - Traffic Class") }, cfg([row(0)])],
    [{ op: "add_variable", entity: v("URL - utm_source") }, { op: "add_variable", entity: v("RT - AI utm_source") }],
    [{ op: "add_variable", entity: v("REF - Referrer") }, { op: "add_variable", entity: v("RT - AI Referrer") }, cfg([row(0), row(1)])],
  ];
  let prev = evaluateGtmSignalQuality(c, snap, { agentTraffic: true }).combinedScore;
  for (const ops of rounds) {
    assertValidOperations(ops);
    const next = applyOperations(c, ops);
    const verdict = validateCandidate(c, next, ops);
    assert.equal(verdict.valid, true, verdict.reason);
    const s = evaluateGtmSignalQuality(next, snap, { agentTraffic: true }).combinedScore;
    assert.ok(s > prev, `${s} > ${prev}`);
    prev = s; c = next;
  }
  const d = evaluateGtmSignalQuality(c, snap, { agentTraffic: true }).dimensions.find((x) => x.name === "agentTraffic")!;
  assert.equal(d.score, 1);
});
