import { readFile } from "node:fs/promises";
import bladeWeb from "../evals/clients/blade_web.js";
import bladeServer from "../evals/clients/blade_server.js";

async function main() {
  const meta = JSON.parse(
    await readFile("data/clients/blade/meta-ads-snapshot.json", "utf-8"),
  );
  const webC = JSON.parse(
    await readFile("content/clients/blade/web-GTM-W9S77T7.json", "utf-8"),
  );
  const serverC = JSON.parse(
    await readFile("content/clients/blade/server-GTM-KJHX6KJ7.json", "utf-8"),
  );

  for (const [label, fn, c] of [
    ["BLADE Web", bladeWeb, webC],
    ["BLADE Server", bladeServer, serverC],
  ] as const) {
    const r = fn(c, meta);
    console.log(`\n=== ${label} baseline: ${(r.combinedScore * 100).toFixed(1)}% ===`);
    for (const d of r.dimensions) {
      const bar = "█".repeat(Math.round(d.score * 10)).padEnd(10, "░");
      console.log(
        `  ${d.name.padEnd(26)} ${bar} ${(d.score * 100).toFixed(0).padStart(3)}% (w=${d.weight})`,
      );
    }
    const errs = r.issues.filter((i) => i.severity === "error").slice(0, 6);
    if (errs.length > 0) {
      console.log("  top errors:");
      for (const i of errs)
        console.log(`    [${i.dimension}] ${i.entity}: ${i.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
