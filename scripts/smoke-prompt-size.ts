import { readFile } from "node:fs/promises";
import bladeWeb from "../evals/clients/blade_web.js";
import bladeServer from "../evals/clients/blade_server.js";
import { evaluateGtmSignalQuality } from "../evals/eval_gtm_signal_quality.js";

async function main() {
  const meta = JSON.parse(
    await readFile("data/clients/blade/meta-ads-snapshot.json", "utf-8"),
  );

  const cases = [
    ["HRE Beauty", evaluateGtmSignalQuality, "content/clients/hre-beauty/shopify-ecom-web.json"],
    ["BLADE Web", bladeWeb, "content/clients/blade/web-GTM-W9S77T7.json"],
    ["BLADE Server", bladeServer, "content/clients/blade/server-GTM-KJHX6KJ7.json"],
  ] as const;

  for (const [label, fn, file] of cases) {
    const c = JSON.parse(await readFile(file, "utf-8"));
    const r = fn(c, meta);
    const fullJsonSize = JSON.stringify(c, null, 2).length;

    // Approximate the right-sized prompt by counting the pieces
    const tags = c.containerVersion.tag ?? [];
    const triggers = c.containerVersion.trigger ?? [];
    const variables = c.containerVersion.variable ?? [];
    const folders = c.containerVersion.folder ?? [];

    const indexSize =
      tags.reduce((s: number, t: { tagId: string; name: string; type: string }) =>
        s + `  [N] ${t.tagId} "${t.name}" type=${t.type} consent=NOT_SET folder=-\n`.length, 0) +
      triggers.reduce((s: number, t: { triggerId: string; name: string; type: string }) =>
        s + `  [N] ${t.triggerId} "${t.name}" type=${t.type}\n`.length, 0) +
      variables.reduce((s: number, v: { variableId: string; name: string; type: string }) =>
        s + `  [N] ${v.variableId} "${v.name}" type=${v.type}\n`.length, 0) +
      folders.reduce((s: number, f: { folderId: string; name: string }) =>
        s + `  [N] ${f.folderId} "${f.name}"\n`.length, 0);

    const schemaSize =
      (tags[0] ? JSON.stringify(tags[0], null, 2).length : 0) +
      (triggers[0] ? JSON.stringify(triggers[0], null, 2).length : 0) +
      (variables[0] ? JSON.stringify(variables[0], null, 2).length : 0);

    // Error-referenced entities (up to 10)
    const errorEntities = new Set(
      r.issues.filter((i) => i.severity === "error").slice(0, 10).map((i) => i.entity),
    );
    const refTags = tags.filter((t: { name: string }) => errorEntities.has(t.name)).slice(0, 10);
    const refSize = refTags.reduce((s: number, t: unknown) => s + JSON.stringify(t, null, 2).length, 0);

    const staticPrompt = 3000; // rough fixed overhead (rules, examples, scores, issues)
    const totalNew = staticPrompt + indexSize + schemaSize + refSize;
    const totalOld = staticPrompt + fullJsonSize;

    const ratio = ((totalNew / totalOld) * 100).toFixed(1);
    console.log(
      `${label.padEnd(14)} full=${(fullJsonSize/1024).toFixed(1)}KB  new=${(totalNew/1024).toFixed(1)}KB  (${ratio}% of old)  baseline=${(r.combinedScore*100).toFixed(1)}%`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
