import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createScoredGtmExport, validateGtmContainer } from "../scripts/gtm-scored-export.js";

const validContainer = {
  exportFormatVersion: 2,
  containerVersion: {
    container: { name: "BLADE web", publicId: "GTM-BLADE", usageContext: ["WEB"] },
    tag: [{ tagId: "1", name: "GA4 - Config", type: "googtag", firingTriggerId: ["1"], parameter: [{ value: "{{Known Variable}}" }] }],
    trigger: [{ triggerId: "1", name: "All Pages", type: "PAGEVIEW" }],
    variable: [{ variableId: "1", name: "Known Variable", type: "c" }],
    folder: [], customTemplate: [], unknownFutureField: { preserve: true },
  },
};
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

test("blocks dangling GTM references without confusing hydration and GTM variables", () => {
  const candidate = structuredClone(validContainer);
  candidate.containerVersion.tag[0].firingTriggerId = ["missing"];
  candidate.containerVersion.tag[0].parameter = [{ value: "{{Missing Variable}} %%ACCOUNT_ID%%" }];
  const validation = validateGtmContainer(candidate);
  assert.equal(validation.status, "blocked");
  assert.match(validation.errors.join("\n"), /missing firingTriggerId/);
  assert.match(validation.errors.join("\n"), /Missing Variable/);
  assert.match(validation.warnings.join("\n"), /%%ACCOUNT_ID%%/);
  assert.doesNotMatch(validation.errors.join("\n"), /ACCOUNT_ID/);
});

test("rejects malformed export members and unsupported consent inventions", () => {
  const malformed = structuredClone(validContainer) as { containerVersion: Record<string, unknown> };
  malformed.containerVersion.tag = [null];
  malformed.containerVersion.trigger = [{ triggerId: "1", name: "Consent", type: "CONSENT_INITIALIZATION_ALL_PAGES" }];
  malformed.containerVersion.variable = [{ variableId: "1", name: "Known Variable", type: "c" }];
  malformed.containerVersion.container = { name: "BLADE", publicId: "GTM-BLADE", usageContext: ["NOT_A_GTM_CONTEXT"] };
  const validation = validateGtmContainer(malformed);
  assert.equal(validation.status, "blocked");
  assert.match(validation.errors.join("\n"), /tag must contain only object entities/);
  assert.match(validation.errors.join("\n"), /CONSENT_INITIALIZATION_ALL_PAGES/);
  assert.match(validation.errors.join("\n"), /recognized GTM usage contexts/);
});

test("validates numeric custom template types and only warns for opaque native types", () => {
  const validTemplate = structuredClone(validContainer);
  validTemplate.containerVersion.customTemplate = [{ templateId: "108", name: "Custom", templateData: "" }];
  validTemplate.containerVersion.tag[0].type = "cvt_123_108";
  assert.equal(validateGtmContainer(validTemplate).status, "passed");
  validTemplate.containerVersion.tag[0].type = "cvt_123_999";
  assert.match(validateGtmContainer(validTemplate).errors.join("\n"), /missing custom template '999'/);
  validTemplate.containerVersion.tag[0].type = "cvt_MBTSV";
  const opaque = validateGtmContainer(validTemplate);
  assert.equal(opaque.status, "passed");
  assert.match(opaque.warnings.join("\n"), /opaque custom template/);
});

test("publishes a hash-bound bundle while retaining exact source bytes", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "gtm-scored-export-test-"));
  const output = path.join(parent, "bundle");
  const bytes = Buffer.from(`${JSON.stringify(validContainer, null, 2)}\n`, "utf8");
  try {
    const result = await createScoredGtmExport({ containerBytes: bytes, outputDir: output, sourceKind: "optimization-winner", createdAt: "2026-09-22T00:00:00.000Z" });
    const saved = await readFile(path.join(output, "container.json"));
    const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
    const report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8"));
    assert.deepEqual(saved, bytes);
    assert.equal(result.report.readiness.status, "ready-for-import-review");
    assert.equal(report.source.sha256, digest(bytes));
    assert.equal(report.source.name, null);
    assert.equal(manifest.files["container.json"], digest(bytes));
    assert.equal(manifest.files["report.json"], digest(await readFile(path.join(output, "report.json"))));
    await assert.rejects(() => createScoredGtmExport({ containerBytes: bytes, outputDir: output, sourceKind: "saved-container" }), /Refusing to overwrite/);
    const hydratedLater = structuredClone(validContainer);
    hydratedLater.containerVersion.tag[0].parameter = [{ value: "%%ACCOUNT_ID%%" }];
    const blocked = await createScoredGtmExport({ containerBytes: JSON.stringify(hydratedLater), outputDir: path.join(parent, "blocked"), sourceKind: "saved-container" });
    assert.equal(blocked.report.validation.status, "passed");
    assert.equal(blocked.report.readiness.status, "blocked");
    assert.match(blocked.report.readiness.blockers.join("\n"), /%%ACCOUNT_ID%%/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
