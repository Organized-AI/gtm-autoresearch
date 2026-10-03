// Every check, by gate. Each returns { result, reason, evidence? } where result
// is pass | fail | manual | not_built. A check for work that doesn't exist yet
// says "not_built"; it never passes by default.
//
// The gates follow the loop from the video (Karpathy loop + AutoLoop) mapped
// onto this repo:
//   train.py          -> the client's seed container JSON (the one mutable file)
//   scoring file      -> evals/eval_gtm_signal_quality.ts (must be locked)
//   program.md        -> content/gtm-templates/<CLIENT>/program.md
//                        fixed rules = Constraints, Budget, Stop Conditions, Weights
//                        how to work = Edit Strategy (the only part AutoLoop may edit)
//   results.tsv       -> content/gtm-templates/<CLIENT>/loop-results/*.json
//   AutoLoop          -> box/autoloop/analyze.mjs
//   "passing checks isn't done" -> staging QA, observed-vs-configured, the Jev shadow judge
import { readdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clients, rows, read, exists, p, sections, findSection, FIXED_RE, HOW_RE, weightsFromProgram, score, winningFor } from "./repo.mjs";
import { analyze, applyProposal } from "../autoloop/analyze.mjs";

const pass = (reason, evidence) => ({ result: "pass", reason, evidence });
const fail = (reason, evidence) => ({ result: "fail", reason, evidence });
const manual = (reason, evidence) => ({ result: "manual", reason, evidence });
const notBuilt = (reason) => ({ result: "not_built", reason });
const pct = (x) => `${(x * 100).toFixed(1)}%`;

let _scoreCache = new Map();
const scoreOnce = (f, s) => { const k = `${f}|${s}`; if (!_scoreCache.has(k)) _scoreCache.set(k, score(f, s)); return _scoreCache.get(k); };
let _auto = null;
const auto = () => (_auto ||= analyze());

export const CHECKS = [
  // ── G0 · The loop contract ────────────────────────────────────────────────
  { gate: "g0", id: "one-mutable-file", why: "Like train.py, each client has exactly one container the loop may change.", run() {
    const cs = clients();
    if (!cs.length) return fail("no clients under content/gtm-templates");
    const bad = cs.filter((c) => !c.tmpl || !exists(c.tmpl));
    return bad.length ? fail(`${bad.length} of ${cs.length} clients name no template file that exists`, bad.map((c) => c.id))
      : pass(`${cs.length} clients, each program.md names one seed container that exists`, cs.map((c) => `${c.id}: ${c.tmpl}`));
  } },
  { gate: "g0", id: "program-split", why: "program.md separates fixed rules from how-to-work, so AutoLoop has a section it may edit and sections it may not.", run() {
    const cs = clients();
    const bad = cs.filter((c) => { const s = sections(c.program); return !findSection(s, HOW_RE) || !findSection(s, /^Constraints/i); });
    return bad.length ? fail(`${bad.length} program.md files lack an Edit Strategy or Constraints section`, bad.map((c) => c.id))
      : pass("every program.md has Constraints (fixed) and Edit Strategy (how to work)", cs.map((c) => `${c.id}: ${Object.keys(sections(c.program)).join(" · ")}`));
  } },
  { gate: "g0", id: "evaluator-deterministic", why: "The score must not move when nothing changed, or keep/revert decisions are noise.", run() {
    const c = clients().find((x) => x.tmpl);
    if (!c) return fail("no client to score");
    const a = score(c.tmpl, c.snap), b = score(c.tmpl, c.snap);
    if (a.error) return manual(`scorer didn't run here (${a.error}); run npm ci in the repo`);
    return a.combinedScore === b.combinedScore && JSON.stringify(a.dimensions) === JSON.stringify(b.dimensions)
      ? pass(`${c.id} seed scored twice: ${pct(a.combinedScore)} both times, all 12 dimensions identical`)
      : fail(`${c.id} seed scored ${pct(a.combinedScore)} then ${pct(b.combinedScore)}`);
  } },
  { gate: "g0", id: "invariants-in-code", why: "Mutations go through typed operations with ID allocation and preservation checks in code, not in the prompt.", run() {
    const loop = read("scripts/run-gtm-loop.ts");
    return exists("scripts/gtm-container-mutations.ts") && /gtm-container-mutations/.test(loop)
      ? pass("run-gtm-loop.ts applies mutations through scripts/gtm-container-mutations.ts")
      : fail("the loop doesn't route mutations through gtm-container-mutations.ts");
  } },
  { gate: "g0", id: "never-publishes", why: "The loop stages; a human publishes. No script may call the GTM publish endpoint.", run() {
    const hits = readdirSync(p("scripts")).filter((f) => /\.(ts|py|mjs|js)$/.test(f))
      .filter((f) => /versions\/[^"'`]*:publish|\.publish\(|publish_gtm_container/.test(read(`scripts/${f}`)));
    return hits.length ? fail(`publish calls found in ${hits.join(", ")}`) : pass("no GTM publish call in scripts/; winners land in winning/ and a staging workspace");
  } },

  // ── G1 · The scorer is locked ─────────────────────────────────────────────
  { gate: "g1", id: "evaluator-locked", why: "The video's guardrail: the agent may not edit the scoring file, or it can raise the score by weakening the test.", run() {
    if (!exists(".claude/settings.json")) return fail("no .claude/settings.json, so nothing stops an agent from editing evals/", ["template: box/templates/claude-settings.json"]);
    const deny = JSON.parse(read(".claude/settings.json"))?.permissions?.deny || [];
    const locked = deny.some((d) => /evals/.test(d));
    return locked ? pass(`deny rules cover evals/: ${deny.filter((d) => /evals/.test(d)).join(", ")}`) : fail("settings.json exists but no deny rule covers evals/");
  } },
  { gate: "g1", id: "evaluator-reproduces", why: "Re-scoring a recorded winner must give the score the ledger recorded. If not, the scorer changed under the results.", run() {
    const out = [], bad = [];
    for (const c of clients()) for (const L of c.ledgers) {
      const w = winningFor(c, L); if (!w) continue;
      const s = scoreOnce(w, c.snap);
      if (s.error) return manual(`scorer didn't run here (${s.error})`);
      const line = `${c.id} ${w.split("/").pop()}: recorded ${pct(L.bestScore)}, re-scored ${pct(s.combinedScore)}`;
      (Math.abs(s.combinedScore - L.bestScore) < 0.0006 ? out : bad).push(line);
    }
    if (!out.length && !bad.length) return manual("no ledger has a timestamp-matched winning file to re-score");
    return bad.length ? fail(`${bad.length} recorded winners no longer score what the ledger says`, bad) : pass(`${out.length} recorded winner re-scored to the same number`, out);
  } },
  { gate: "g1", id: "fixed-rules-enforced", why: "Editing the Constraints or Edit Strategy in program.md has to change what the loop does.", run() {
    const loop = read("scripts/run-gtm-loop.ts");
    const hard = /const strategyOrder = \[/.test(loop) && /const constraints = \[/.test(loop);
    return hard ? fail("parseProgram() reads only the file paths from program.md. strategyOrder and constraints are hardcoded arrays, and pickStrategy() ignores strategyOrder, so editing either section changes nothing", ["scripts/run-gtm-loop.ts parseProgram(), pickStrategy()"])
      : pass("parseProgram() reads Constraints and Edit Strategy from program.md");
  } },
  { gate: "g1", id: "weights-agree", why: "The weights a human reads in program.md must be the weights the scorer applies.", run() {
    const out = [], bad = [];
    for (const c of clients()) {
      if (!c.tmpl) continue;
      const s = scoreOnce(c.tmpl, c.snap); if (s.error) return manual(`scorer didn't run here (${s.error})`);
      const w = weightsFromProgram(c.program);
      const missing = Object.keys(w).filter((k) => !s.dimensions.some((d) => d.name === k));
      const diff = s.dimensions.filter((d) => w[d.name] !== undefined && Math.abs(w[d.name] - d.weight) > 1e-9).map((d) => `${d.name} ${w[d.name]}→${d.weight}`);
      const head = missing.length ? `${c.id}: program.md lists ${Object.keys(w).length} dimensions, the scorer applied ${s.dimensions.length} (dropped ${missing.join(", ")}: no data for it in ${c.snap || "the snapshot"}) and reweighted the rest` : `${c.id}`;
      (diff.length || missing.length ? bad : out).push(diff.length || missing.length ? `${head}: ${diff.join(", ")}` : `${c.id}: ${s.dimensions.length}/${Object.keys(w).length} weights match`);
    }
    return bad.length ? fail(`${bad.map((b) => b.split(":")[0]).join(", ")} is scored on different dimensions or weights than its program.md says`, [...bad, ...out]) : pass("program.md weights match the scorer for every client", out);
  } },

  // ── G2 · The ledger can teach ─────────────────────────────────────────────
  { gate: "g2", id: "ledger-exists", why: "Every run leaves a round-by-round record: the results.tsv of this loop.", run() {
    const cs = clients(); const n = cs.reduce((a, c) => a + c.ledgers.length, 0); const r = cs.reduce((a, c) => a + rows(c).length, 0);
    const by = {}; cs.forEach((c) => rows(c).forEach((x) => (by[x.action] = (by[x.action] || 0) + 1)));
    return n ? pass(`${n} run ledgers, ${r} rounds: ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", ")}`) : fail("no loop-results ledgers");
  } },
  { gate: "g2", id: "attempt-recorded", why: "AutoLoop learns from what was tried and what still failed. A revert that only says 'reverted' teaches nothing.", run() {
    const b = auto().blind; const rev = b.reduce((a, x) => a + x.reverted, 0), d = b.reduce((a, x) => a + x.described, 0);
    return rev && d === rev ? pass(`all ${rev} reverted rounds record strategy, operations and candidate scores`)
      : fail(`${rev - d} of ${rev} reverted rounds record only "X% <= Y%, reverted": no strategy, no operations, no candidate dimensions`, b.map((x) => `${x.client}: ${x.described}/${x.reverted} described`));
  } },
  { gate: "g2", id: "stall-stop", why: "Failed rounds still cost tokens. A run should stop when it stops learning.", run() {
    const stalls = auto().habits.filter((h) => h.id === "same-target-stall");
    return stalls.length ? fail(stalls.map((h) => `${h.client}: ${h.count} of ${h.of} rounds reverted in a row (rounds ${h.rounds}) and no stop fired`).join("; "), stalls.map((h) => h.ledger))
      : pass("no run reverted 3+ rounds in a row on an unchanged container");
  } },
  { gate: "g2", id: "failure-stop", why: "Five provider failures in a row must end the run.", run() {
    const runs = clients().flatMap((c) => c.ledgers.map((L) => ({ c: c.id, L, fails: L.results.filter((r) => r.action === "json_fail").length })));
    const all = runs.filter((x) => x.fails === x.L.results.length && x.fails > 0);
    const over = all.filter((x) => x.fails > 5);
    if (over.length) return fail(`${over.length} runs kept going past 5 failures`);
    return all.length ? pass(`the all-failure run stopped at ${all[0].fails} rounds (${all[0].c} ${all[0].L.file.split("/").pop()})`) : manual("no all-failure run on record to confirm the stop");
  } },
  { gate: "g2", id: "manifest-current", why: "manifest.json is what a human reads to find the best container. It has to point at the actual best.", run() {
    const bad = [], ok = [];
    for (const c of clients()) {
      if (!c.manifest?.best?.score || !c.ledgers.length) continue;
      const top = Math.max(...c.ledgers.map((L) => L.bestScore));
      (top * 100 - c.manifest.best.score > 0.05 ? bad : ok).push(`${c.id}: manifest says ${c.manifest.best.score}% (${c.manifest.best.file}), best ledger ${pct(top)}`);
    }
    return bad.length ? fail(`${bad.length} manifest points at an older winner`, bad) : pass("manifests point at the best recorded winner", ok);
  } },

  // ── G3 · AutoLoop ─────────────────────────────────────────────────────────
  { gate: "g3", id: "autoloop-finds-habits", why: "The outer loop reads every ledger and names habits that repeat, with the rounds as evidence.", run() {
    const a = auto();
    return a.habits.length ? pass(`${a.habits.length} recurring habits found across ${new Set(a.habits.map((h) => h.client)).size} clients`, a.habits.map((h) => `${h.client} ${h.id}: ${h.count} rounds`))
      : fail("no habits found");
  } },
  { gate: "g3", id: "autoloop-scope", why: "AutoLoop may rewrite Edit Strategy only. Constraints, budget, stop conditions, weights and evals/ stay byte-identical.", run() {
    const a = auto(); if (!a.proposals.length) return manual("no proposal to test");
    const dir = mkdtempSync(join(tmpdir(), "arb-"));
    try {
      for (const pr of a.proposals) {
        const before = read(pr.file); const after = applyProposal(before, pr);
        writeFileSync(join(dir, "after.md"), after);
        const s0 = sections(before), s1 = sections(readFileSync(join(dir, "after.md"), "utf8"));
        const touched = Object.keys(s0).filter((k) => s0[k] !== s1[k]);
        if (touched.some((k) => FIXED_RE.test(k)) || touched.some((k) => !HOW_RE.test(k))) return fail(`${pr.client} proposal touched ${touched.join(", ")}`);
      }
      return pass(`${a.proposals.length} proposals applied to a copy; only "Edit Strategy" changed, every fixed section byte-identical`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  } },
  { gate: "g3", id: "autoloop-takes-effect", why: "A rewritten Edit Strategy must reach the next run's mutation prompt.", run() {
    return /const strategyOrder = \[/.test(read("scripts/run-gtm-loop.ts"))
      ? fail("blocked by g1 fixed-rules-enforced: the loop hardcodes its strategy, so an AutoLoop rewrite would be ignored")
      : pass("the loop reads Edit Strategy from program.md");
  } },
  { gate: "g3", id: "owner-approves", why: "An AutoLoop rewrite lands as a pull request; only the owner merges it.", run: () => notBuilt("arb autoloop --pr is not built; proposals are written to box/proof for review") },

  // ── G4 · Beyond the score ────────────────────────────────────────────────
  { gate: "g4", id: "shadow-judge", why: "Jev watches each keep/revert in shadow mode, journaled, with no authority over the loop.", run() {
    return exists("scripts/jev-shadow.ts") && exists("DOCUMENTATION/jev-shadow-pilot/RUBRIC-V2-RESULTS.md")
      ? pass("Jev shadow mode is wired into run-gtm-loop.ts with a frozen journal; rubric v2 results recorded; enforcement off") : fail("no Jev shadow path");
  } },
  { gate: "g4", id: "staging-qa", why: "The video's restaurant case: 11/11 checks passed and the order form was still missing. Each kept round needs a preview-mode tag-firing check.", run() {
    return /qa: \{ status: "absent" \}/.test(read("scripts/run-gtm-loop.ts"))
      ? notBuilt("kept rounds pass qa: { status: \"absent\" } to the judge; no Playwright preview run per round yet") : manual("check QA evidence by hand");
  } },
  { gate: "g4", id: "observed-vs-configured", why: "Compare what the container is configured to send with what actually fires on the site.", run: () => notBuilt("jev-site-scan exists as its own Worker; not yet called from the loop") },
  { gate: "g4", id: "human-publish", why: "A person reviews the winner and the data audit, then publishes the staging workspace.", run: () => manual("by design: the owner publishes; the box records who and when") },
];

export const GATES = ["g0", "g1", "g2", "g3", "g4"];
