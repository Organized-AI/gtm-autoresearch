#!/usr/bin/env node
// arb: Autoresearch in a Box. No dependencies beyond the repo's own (tsx runs the scorer). Node 22+.
//
//   arb check [g0..g4|all] [--why] [--json]   done-when checks against this repo
//   arb autoloop [--write]                    read every ledger, name repeating habits,
//                                             propose an Edit Strategy rewrite (--write saves it under box/proof/)
//   arb replay <loop-results.json>            stream a recorded run round by round
//   arb stream                                tail the live feed from the Worker
//
// Env: ARB_REPO          gtm-autoresearch root (default: the repo this file lives in)
//      ARB_URL           suite Worker URL (events are posted when set)
//      ARB_INGEST_TOKEN  bearer token for POST /api/events
//      ARB_RECORD        path to append events as JSONL (the proof file)

import { appendFileSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { CHECKS, GATES } from "../checks/index.mjs";
import { analyze, applyProposal } from "../autoloop/analyze.mjs";
import { ROOT, read } from "../checks/repo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const [cmd = "help", ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const args = rest.filter((a) => !a.startsWith("--"));
const RUN_ID = randomUUID();
const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", c: "\x1b[36m", x: "\x1b[0m" };
const color = (res) => ({ pass: C.g, fail: C.r, manual: C.y, not_built: C.d }[res] || "");

let seq = 0;
async function emit(kind, data) {
  const ev = { run_id: RUN_ID, seq: seq++, at: new Date().toISOString(), kind, ...data };
  if (process.env.ARB_RECORD) appendFileSync(process.env.ARB_RECORD, JSON.stringify(ev) + "\n");
  if (process.env.ARB_URL && process.env.ARB_INGEST_TOKEN) {
    try {
      const r = await fetch(new URL("/api/events", process.env.ARB_URL), {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ARB_INGEST_TOKEN}` }, body: JSON.stringify(ev),
      });
      if (!r.ok) console.error(`${C.y}stream: ${r.status} ${await r.text()}${C.x}`);
    } catch (e) { console.error(`${C.y}stream: ${e.message}${C.x}`); }
  }
  return ev;
}

async function check() {
  const want = (args[0] || "all").toLowerCase();
  const gates = want === "all" ? GATES : [want];
  if (!gates.every((g) => GATES.includes(g))) die(`unknown gate ${want}`, `use one of ${GATES.join(", ")} or all`);
  const target = `Organized-AI/gtm-autoresearch@${gitHead()}`;
  await emit("run.start", { target, gates });
  const tally = { pass: 0, fail: 0, manual: 0, not_built: 0 }, results = [];
  for (const g of gates) {
    console.log(`\n${C.c}${g.toUpperCase()}${C.x}`);
    for (const chk of CHECKS.filter((c) => c.gate === g)) {
      const t = Date.now();
      let r;
      try { r = await chk.run(); } catch (e) { r = { result: "fail", reason: `check crashed: ${e.message}` }; }
      const ms = Date.now() - t;
      tally[r.result]++;
      results.push({ gate: g, id: chk.id, ...r });
      console.log(`  ${color(r.result)}${r.result.padEnd(9)}${C.x} ${chk.id.padEnd(24)} ${r.reason}`);
      if (flags.has("--why")) console.log(`  ${C.d}${" ".repeat(9)} ${"".padEnd(24)} why: ${chk.why}${C.x}`);
      await emit("check", { gate: g, check_id: chk.id, result: r.result, reason: r.reason, why: chk.why, ms, evidence: r.evidence ?? null });
    }
  }
  await emit("run.end", tally);
  console.log(`\n${C.g}${tally.pass} pass${C.x} · ${C.r}${tally.fail} fail${C.x} · ${C.y}${tally.manual} manual${C.x} · ${tally.not_built} not built`);
  if (flags.has("--json")) writeFileSync("arb-results.json", JSON.stringify({ run_id: RUN_ID, tally, results }, null, 2));
}

async function autoloop() {
  const a = analyze();
  await emit("loop.stage", { stage: "read", note: `${a.blind.reduce((x, b) => x + b.reverted, 0)} reverted rounds read across ${a.blind.length} clients` });
  for (const h of a.habits) {
    console.log(`\n${C.y}habit${C.x} ${h.client} · ${h.id}\n  ${h.claim}`);
    await emit("autoloop.habit", { habit: h.id, client: h.client, count: h.count, claim: h.claim, ledger: h.ledger || null, target: h.target || null, need: h.need ?? null, budget: h.budget ?? null });
  }
  for (const b of a.blind) if (b.described < b.reverted) {
    console.log(`\n${C.d}blind spot${C.x} ${b.client}: ${b.reverted - b.described} of ${b.reverted} reverted rounds don't say what they tried`);
    await emit("loop.stage", { stage: "blind", note: `${b.client}: ${b.reverted - b.described}/${b.reverted} reverts record no attempt` });
  }
  const outDir = join(HERE, "..", "proof");
  for (const pr of a.proposals) {
    const after = applyProposal(read(pr.file), pr);
    console.log(`\n${C.c}proposal${C.x} ${pr.file} · section "${pr.section}" only\n${pr.add.map((l) => `  + ${l}`).join("\n")}`);
    if (pr.owner?.length) console.log(`  ${C.d}for the owner (fixed rules, not applied):\n${pr.owner.map((l) => `    · ${l}`).join("\n")}${C.x}`);
    await emit("autoloop.proposal", { client: pr.client, file: pr.file, section: pr.section, lines: pr.add, owner: pr.owner || [] });
    if (flags.has("--write")) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, `program.${pr.client}.proposed.md`), after);
      if (pr.owner?.length) writeFileSync(join(outDir, `owner-notes.${pr.client}.md`), `# ${pr.client}: changes only the owner can make\n\nAutoLoop may not edit the scorer, the weights, the constraints or the loop code. These came out of the same evidence and need a person.\n\n${pr.owner.map((l) => `- ${l}`).join("\n")}\n`);
    }
  }
  await emit("loop.stage", { stage: "stage", note: `${a.proposals.length} proposals staged for owner review; program.md unchanged` });
}

async function replay() {
  const f = args[0] || die("replay needs a ledger", "arb replay content/gtm-templates/BLADE/loop-results/2026-04-29T143650.json");
  const L = JSON.parse(readFileSync(resolve(ROOT, f), "utf8"));
  await emit("run.start", { target: f, gates: ["ledger"], start_score: L.startScore });
  for (const r of L.results) {
    console.log(`  ${String(r.round).padStart(2)} ${r.action.padEnd(9)} ${(r.score * 100).toFixed(1)}%  ${r.mutationSummary}`);
    await emit("loop.round", { ledger: f, round: r.round, action: r.action, score: r.score, summary: r.mutationSummary, issues: r.issueCount });
  }
  await emit("run.end", { pass: L.results.filter((r) => r.action === "improved").length, fail: L.results.filter((r) => r.action === "reverted").length, manual: 0, not_built: 0, json_fail: L.results.filter((r) => r.action === "json_fail").length, best: L.bestScore });
}

async function stream() {
  if (!process.env.ARB_URL) die("ARB_URL not set", "Point it at the suite Worker.");
  const res = await fetch(new URL("/api/stream", process.env.ARB_URL));
  const dec = new TextDecoder();
  for await (const chunk of res.body) process.stdout.write(dec.decode(chunk));
}

function gitHead() {
  try { return read(".git/HEAD").startsWith("ref:") ? read(`.git/${read(".git/HEAD").slice(5).trim()}`).trim().slice(0, 7) : read(".git/HEAD").trim().slice(0, 7); }
  catch { return "local"; }
}
function die(msg, fix) { console.error(`${C.r}${msg}${C.x}${fix ? `\n${fix}` : ""}`); process.exit(1); }

const COMMANDS = { check, autoloop, replay, stream };
if (!COMMANDS[cmd]) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 14).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(cmd === "help" ? 0 : 1);
}
await COMMANDS[cmd]();
