// Reads the gtm-autoresearch repo the way the loop sees it: one folder per
// client under content/gtm-templates, each with a program.md contract, a seed
// container (the one mutable file), winning containers and run ledgers.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(process.env.ARB_REPO || join(HERE, "..", ".."));
export const p = (...a) => join(ROOT, ...a);
export const read = (f) => readFileSync(p(f), "utf8");
export const exists = (f) => existsSync(p(f));

const TEMPLATES = "content/gtm-templates";

// "## Edit Strategy (priority order)" -> body text up to the next "## ".
export function sections(md) {
  const out = {};
  let name = null;
  for (const line of md.split("\n")) {
    const m = line.match(/^## (.+)$/);
    if (m) { name = m[1].trim(); out[name] = []; continue; }
    if (name) out[name].push(line);
  }
  for (const k of Object.keys(out)) out[k] = out[k].join("\n").trim();
  return out;
}
export const findSection = (secs, re) => Object.keys(secs).find((k) => re.test(k));

// The fixed rules a human owns, and the working habits AutoLoop may rewrite.
export const FIXED_RE = /^Constraints|^Mutation Budget|^Stop Conditions|^Eval Dimensions/i;
export const HOW_RE = /^Edit Strategy/i;

// Weights table: "| 1 | Tag coverage | 0.14 | ..." -> { tagCoverage: 0.14 }
const DIM_KEYS = {
  "tag coverage": "tagCoverage", "parameter completeness": "paramCompleteness", deduplication: "deduplication",
  "consent settings": "consentSettings", "naming conventions": "namingConventions", "variable hygiene": "variableHygiene",
  "trigger quality": "triggerQuality", "folder organization": "folderOrganization", "meta ads alignment": "metaAdsAlignment",
  "capi coverage": "capiCoverage", "funnel integrity": "funnelIntegrity", "google ads alignment": "googleAdsAlignment",
};
export function weightsFromProgram(md) {
  const w = {};
  for (const m of md.matchAll(/^\|\s*\d+\s*\|\s*([^|]+?)\s*\|\s*([0-9.]+)\s*\|/gm)) {
    const key = DIM_KEYS[m[1].toLowerCase()];
    if (key) w[key] = Number(m[2]);
  }
  return w;
}

export function clients() {
  if (!exists(TEMPLATES)) return [];
  return readdirSync(p(TEMPLATES)).filter((d) => statSync(p(TEMPLATES, d)).isDirectory()).map((id) => {
    const dir = `${TEMPLATES}/${id}`;
    const programFile = `${dir}/program.md`;
    const program = exists(programFile) ? read(programFile) : "";
    const tmpl = program.match(/Template file:\s*`([^`]+)`/)?.[1] || null;
    const snap = program.match(/Enriched Ads snapshot:\s*`([^`]+)`/)?.[1] || null;
    const ledgerDir = `${dir}/loop-results`;
    const ledgers = exists(ledgerDir)
      ? readdirSync(p(ledgerDir)).filter((f) => f.endsWith(".json")).sort().map((f) => ({ file: `${ledgerDir}/${f}`, ...JSON.parse(read(`${ledgerDir}/${f}`)) }))
      : [];
    const winningDir = `${dir}/winning`;
    const winning = exists(winningDir) ? readdirSync(p(winningDir)).filter((f) => f.endsWith(".json")).sort().map((f) => `${winningDir}/${f}`) : [];
    const manifest = exists(`${dir}/manifest.json`) ? JSON.parse(read(`${dir}/manifest.json`)) : null;
    return { id, dir, programFile, program, tmpl, snap: snap && exists(snap) ? snap : null, ledgers, winning, manifest };
  });
}

// Every ledger's rounds as flat rows: the results.tsv the video's AutoLoop reads.
export function rows(c) {
  return c.ledgers.flatMap((L) => L.results.map((r) => ({ client: c.id, ledger: L.file, run: L.startTime, ...r })));
}

// Score with the repo's own evaluator. Returns null when tsx is unavailable.
export function score(container, snapshot) {
  const args = ["tsx", join(HERE, "score.ts"), p(container)];
  if (snapshot) args.push(p(snapshot));
  const r = spawnSync("npx", ["--no-install", ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return { error: (r.stderr || r.stdout || "").trim().split("\n").slice(-2).join(" ") };
  try { return JSON.parse(r.stdout); } catch { return { error: "scorer printed non-JSON" }; }
}

// The winning file a ledger produced: same timestamp in the name, else newest.
export function winningFor(c, ledger) {
  const stamp = ledger.file.split("/").pop().replace(".json", "");
  return c.winning.find((w) => w.includes(stamp)) || null;
}
