import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GtmContainer } from "../evals/eval_gtm_signal_quality.js";
import {
  applyOperations,
  assertValidOperations,
  validateCandidate,
} from "../scripts/gtm-container-mutations.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixture(relativePath: string): Promise<GtmContainer> {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8")) as GtmContainer;
}

function maxId(entities: Array<{ [key: string]: unknown }>, field: string): number {
  return Math.max(...entities.map((entity) => Number(entity[field])));
}

test("uses each real export as a structural baseline without changing unknown fields", async () => {
  for (const fixturePath of [
    "content/gtm-templates/HRE/seed/shopify-ecom-web.json",
    "content/gtm-templates/BLADE/seed/blade-web.json",
    "content/gtm-templates/BLADE/seed/blade-sgtm.json",
  ]) {
    const baseline = await fixture(fixturePath);
    const first = baseline.containerVersion.tag?.[0];
    assert.ok(first);
    const candidate = applyOperations(baseline, [{
      op: "rename_tags",
      renames: [{ tagId: first.tagId, newName: `${first.name} (reviewed)` }],
    }]);

    assert.deepEqual(candidate.containerVersion.customTemplate, baseline.containerVersion.customTemplate);
    assert.deepEqual(candidate.containerVersion.client, baseline.containerVersion.client);
    assert.equal(candidate.containerVersion.tag?.[0].fingerprint, first.fingerprint);
    assert.equal(baseline.containerVersion.tag?.[0].name, first.name);
  }
});

test("allocates IDs and container identity in deterministic code", async () => {
  const baseline = await fixture("content/gtm-templates/BLADE/seed/blade-web.json");
  const candidate = applyOperations(baseline, [{
    op: "add_variable",
    entity: { name: "Const - Test Value", type: "c", parameter: [] },
  }]);
  const variable = candidate.containerVersion.variable?.at(-1);
  assert.ok(variable);
  assert.equal(variable.variableId, String(maxId(baseline.containerVersion.variable ?? [], "variableId") + 1));
  assert.equal(variable.accountId, baseline.containerVersion.variable?.[0].accountId);
  assert.equal(variable.containerId, baseline.containerVersion.variable?.[0].containerId);
});

test("rejects model-supplied IDs and unauthorized tag fields", async () => {
  assert.throws(() => assertValidOperations([{
    op: "add_tag", entity: { tagId: "999", name: "Bad", type: "html" },
  }]));
  assert.throws(() => assertValidOperations([{
    op: "modify_tag", tagId: "1", changes: { type: "html" },
  }]));
});

test("rejects missing references before the candidate can be scored", async () => {
  const baseline = await fixture("content/gtm-templates/HRE/seed/shopify-ecom-web.json");
  assert.throws(() => applyOperations(baseline, [{
    op: "add_tag",
    entity: {
      name: "GA4 - Bad Reference",
      type: "gaawe",
      parameter: [],
      firingTriggerId: ["does-not-exist"],
      parentFolderId: "does-not-exist",
    },
  }]), /unknown (firingTriggerId|folderId)/);
});

test("detects a candidate that changes a baseline field outside its operation", async () => {
  const baseline = await fixture("content/gtm-templates/HRE/seed/shopify-ecom-web.json");
  const candidate = structuredClone(baseline);
  candidate.containerVersion.tag![0].type = "html";
  const validation = validateCandidate(baseline, candidate, [{
    op: "rename_tags", renames: [{ tagId: candidate.containerVersion.tag![0].tagId, newName: candidate.containerVersion.tag![0].name }],
  }]);
  assert.equal(validation.valid, false);
  assert.match(validation.reason, /unauthorized field/);
});

test("retains baseline placeholders even when an allowed field is patched", async () => {
  const baseline = await fixture("content/gtm-templates/HRE/seed/shopify-ecom-web.json");
  const tag = baseline.containerVersion.tag![0];
  tag.parameter = [{ type: "TEMPLATE", key: "test", value: "%%UNIQUE_TEST_PLACEHOLDER%%" }];
  const candidate = structuredClone(baseline);
  candidate.containerVersion.tag![0].parameter = [];
  const validation = validateCandidate(baseline, candidate, [{
    op: "modify_tag", tagId: tag.tagId, changes: { parameter: [] },
  }]);
  assert.equal(validation.valid, false);
  assert.match(validation.reason, /Placeholder/);
});
