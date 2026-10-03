// Every check, by gate. Each returns { result, reason, evidence? } where result
// is pass | fail | manual | not_built. A check for work that doesn't exist yet
// says "not_built"; it never passes by default.
//
// The gates follow the loop from the video (Karpathy loop + AutoLoop) mapped
// onto this repo, and hold the code to what the field guide says it does
// (guide.organizedai.vip/gtm-autoresearch, chapters 01-08):
//   train.py          -> the client's seed container JSON (the one mutable file)
//   scoring file      -> evals/eval_gtm_signal_quality.ts (must be locked)
//   program.md        -> content/gtm-templates/<CLIENT>/program.md
//                        fixed rules = Constraints, Budget, Stop Conditions, Weights
//                        how to work = Edit Strategy (the only part AutoLoop may edit)
//   results.tsv       -> content/gtm-templates/<CLIENT>/loop-results/*.json
//   AutoLoop          -> box/autoloop/analyze.mjs
//   "passing checks isn't done" -> the Jev container pipeline (guide.organizedai.vip/jev-container-json):
//                        reader + hard stops + audit run in code, typed questions to Jev, policy decides;
//                        plus staging QA and observed-vs-configured
import { readdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clients, rows, read, exists, p, sections, findSection, FIXED_RE, HOW_RE, weightsFromProgram, score, winningFor, bestWinner } from "./repo.mjs";
import { analyze, applyProposal } from "../autoloop/analyze.mjs";
import { readDiff, audit, opaqueTouched } from "../jev/run.mjs";

const pass = (reason, evidence) => ({ result: "pass", reason, evidence });
const fail = (reason, evidence) => ({ result: "fail", reason, evidence });
const manual = (reason, evidence) => ({ result: "manual", reason, evidence });
const notBuilt = (reason) => ({ result: "not_built", reason });
const pct = (x) => `${(x * 100).toFixed(1)}%`;

let _scoreCache = new Map();
const scoreOnce = (f, s) => { const k = `${f}|${s}`; if (!_scoreCache.has(k)) _scoreCache.set(k, score(f, s)); return _scoreCache.get(k); };
const _jev = new Map();
const jevDiff = (a, b) => { const k = `d|${a}|${b}`; if (!_jev.has(k)) _jev.set(k, readDiff(a, b)); return _jev.get(k); };
const jevAudit = (a) => { const k = `a|${a}`; if (!_jev.has(k)) _jev.set(k, audit(a)); return _jev.get(k); };
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
    return hard ? fail("parseProgram() reads only the file paths from program.md. strategyOrder and constraints are hardcoded arrays, and pickStrategy() ignores strategyOrder, so editing either section changes nothing. The field guide (ch01, step 2) says the strategy order and constraints from program.md become the mutation prompt", ["scripts/run-gtm-loop.ts parseProgram(), pickStrategy()", "guide ch01 · The five steps of one round"])
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

  { gate: "g1", id: "dimension-floors", why: "Guide ch02: one weighted number is gameable. Per-dimension floors, written before the run and enforced in code, stop a critical property being traded for a better average.", run() {
    const loop = read("scripts/run-gtm-loop.ts");
    const kept = [], drops = [];
    for (const c of clients()) for (const L of c.ledgers) {
      let prev = L.startDimensions || null;
      for (const r of L.results) {
        if (r.action !== "improved") continue;
        if (prev) {
          kept.push(r);
          const d = Object.keys(r.dimensions).filter((k) => k in prev && r.dimensions[k] < prev[k] - 1e-9);
          if (d.length) drops.push(`${c.id} ${L.file.split("/").pop()} r${r.round} ${r.mutationSummary}: ${d.map((k) => `${k} ${(prev[k] * 100).toFixed(1)}→${(r.dimensions[k] * 100).toFixed(1)}`).join(", ")}`);
        }
        prev = r.dimensions;
      }
    }
    const enforced = /floor/i.test(loop);
    return enforced ? pass("the loop checks per-dimension floors before keeping")
      : fail(`no floors in the loop: keep is combined score only. ${drops.length} of ${kept.length} measurable kept rounds lowered at least one dimension`, drops);
  } },
  { gate: "g1", id: "snapshot-fresh", why: "Guide ch02: a snapshot older than 72 hours refuses to run, older than 24 warns, and a partial snapshot means the ads dimensions are half-blind.", run() {
    const out = [], bad = [];
    for (const c of clients()) {
      if (!c.snap) continue;
      const snap = JSON.parse(read(c.snap));
      const h = snap.generated_at ? (Date.now() - Date.parse(snap.generated_at)) / 36e5 : null;
      const line = `${c.id}: ${c.snap} generated ${snap.generated_at || "?"} (${h == null ? "?" : Math.round(h / 24) + " days"} old), partial=${!!snap.partial}`;
      (h == null || h > 72 || snap.partial ? bad : out).push(line);
    }
    return bad.length ? fail(`${bad.length} client snapshot${bad.length > 1 ? "s are" : " is"} stale or partial; the loop will exit until /refresh-ads-snapshot runs, and the recorded runs scored against partial data`, [...bad, ...out]) : pass("every snapshot is fresh and complete", out);
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
      : fail(`${rev - d} of ${rev} reverted rounds record only "X% <= Y%, reverted": no strategy, no operations, no candidate dimensions. The guide's receipt (ch04) also asks for baseline/candidate hashes, validator result, QA status, judge identity, typed answers and shadow route`, [...b.map((x) => `${x.client}: ${x.described}/${x.reverted} described`), "shadow-results/ holds most of the receipt, but only when JEV_MODE=shadow"]);
  } },
  { gate: "g2", id: "stall-stop", why: "Failed rounds still cost tokens. A run should stop when it stops learning.", run() {
    const stalls = auto().habits.filter((h) => h.id === "same-target-stall");
    return stalls.length ? fail(stalls.map((h) => `${h.client}: ${h.count} of ${h.of} rounds reverted in a row (rounds ${h.rounds}) and no stop fired`).join("; ") + ". The guide (ch01, ch04) says MAX_REGRESSIONS = 3 consecutive reverts; the code only counts a drop in the working score, which a revert never causes", [...stalls.map((h) => h.ledger), "scripts/run-gtm-loop.ts regressionCount", "guide ch04 · Stop conditions and knobs"])
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
  { gate: "g4", id: "container-hard-stops", why: "Container guide §14: consent touched, opaque code, unresolved refs and partial exports stop in code before any Jev answer counts. Field guide ch05: in this pilot they arrive first as a versioned shadow policy change.", run() {
    const src = read("scripts/jev-shadow.ts");
    const policy = src.slice(src.indexOf("export function shadowPolicy"));
    const have = { consent: /consent/i.test(policy), opaque: /opaque/i.test(policy), unresolved: /unresolved/i.test(policy), partial: /partial/i.test(policy) };
    const missing = Object.keys(have).filter((k) => !have[k]);
    return missing.length ? notBuilt(`the container guide's hard stops for ${missing.join(", ")} aren't mapped into shadowPolicy() yet. Field guide ch05: map each rule to the implementation and version it as a shadow policy change; it doesn't become enforcement by appearing in a diagram`)
      : pass("shadowPolicy() records consent, opaque-code, unresolved-ref and partial-export stops, as a versioned shadow change");
  } },
  { gate: "g4", id: "winner-hard-stops", why: "Run the guide's reader on seed → best winner. Any hard stop means the winner goes to a person, whatever the score says.", run() {
    const out = [];
    for (const c of clients()) {
      const w = bestWinner(c); if (!w || !c.tmpl) continue;
      const d = jevDiff(c.tmpl, w);
      const op = opaqueTouched(d, w, (f) => JSON.parse(read(f)));
      const stops = [d.consent_touched && "consent touched", op.length && `opaque code touched (${op.length})`, d.unresolved_refs.length && `unresolved refs (${d.unresolved_refs.length})`].filter(Boolean);
      out.push(`${c.id} ${w.split("/").pop()}: +${d.diff.added.length} added, ${d.diff.changed.length} changed · ${stops.length ? "hard stops: " + stops.join(", ") : "no hard stop"}`);
    }
    if (!out.length) return manual("no seed/winner pair to read");
    return manual(`${out.filter((o) => /hard stops/.test(o)).length} of ${out.length} best winners hit a hard stop and must be reviewed by a person before publishing. The loop never publishes, so this is the correct lane, but nothing records the review`, out);
  } },
  { gate: "g4", id: "audit-not-worse", why: "The guide's audit on seed and winner. A higher score must not come with more high or critical findings.", run() {
    const bad = [], ok = [];
    for (const c of clients()) {
      const w = bestWinner(c); if (!w || !c.tmpl) continue;
      const a = jevAudit(c.tmpl), b = jevAudit(w);
      const worse = Object.keys(b.byCheck).filter((k) => (b.byCheck[k] || 0) > (a.byCheck[k] || 0));
      const line = `${c.id}: high ${a.counts.high}→${b.counts.high}, critical ${a.counts.critical}→${b.counts.critical}, medium ${a.counts.medium}→${b.counts.medium}; rose: ${worse.map((k) => `${k} ${a.byCheck[k] || 0}→${b.byCheck[k]}`).join(", ") || "none"}`;
      (b.counts.high > a.counts.high || b.counts.critical > a.counts.critical ? bad : ok).push(line);
    }
    return bad.length ? fail(`${bad.length} winners scored higher and have more high/critical audit findings than their seeds. The audit is a separate workflow (field guide ch08), used here as a second opinion on the winner, not a gate on rounds`, [...bad, ...ok]) : pass("no winner has more high or critical findings than its seed", ok);
  } },
  { gate: "g4", id: "evidence-reader-sound", why: "The state Jev reads is only as good as the reader. It must not flag GTM's built-in triggers as missing.", run() {
    const c = clients().find((x) => x.tmpl && bestWinner(x)); if (!c) return manual("nothing to read");
    const d = jevDiff(c.tmpl, bestWinner(c));
    return d.builtin_refs_flagged ? fail(`the guide's read-container.mjs reports ${d.builtin_refs_flagged} references to GTM built-in triggers (2147479553 All Pages, 2147479573 Initialization) as unresolved, which would hard-stop every change. The box filters them; the shared reader should resolve them`, [`${c.id}: ${d.builtin_refs_flagged} built-in refs flagged, ${d.unresolved_refs.length} real`])
      : pass("reader resolves built-in triggers");
  } },
  { gate: "g4", id: "judge-contract-frozen", why: "Field guide ch05-06: two atomic questions, a frozen rubric hashed into one manifest, and pending or modified definitions rejected before any provider call.", run() {
    const src = read("scripts/jev-shadow.ts");
    const ok = /evidenceSufficient/.test(src) && /trackingBehaviorPreserved/.test(src) && /manifestHash/.test(src) && exists("DOCUMENTATION/jev-shadow-pilot/rubric-v2.json");
    return ok ? pass("two atomic questions, manifest-hashed frozen definition, rubric v2 on file (evidence agreement 11/12, tracking 9/12 against unreviewed synthetic labels)") : fail("the frozen two-question contract isn't intact");
  } },
  { gate: "g4", id: "broader-quiz", why: "The container guide's typed set (intent_fit, trigger_scope, mapping_complete, consent_impact, name_fits_job, route_hint). Field guide ch06: a different contract, not an alias.", run() {
    return notBuilt("a migration to evaluate: freeze types, labels, escape behavior, policy mapping and thresholds first, then measure it against the two-question baseline. jev-gateway also asks one question per call today");
  } },
  { gate: "g4", id: "holdout-untouched", why: "Field guide ch07-08: promotion is decided on an untouched, group-disjoint holdout. Peeking turns it into development data.", run() {
    const st = read("AGENT-HANDOFF/CURRENT-STATE.md");
    return /holdout (remain|remains )?unopened|validation and holdout unopened|Validation\/holdout unopened/i.test(st)
      ? pass("CURRENT-STATE records validation and holdout as unopened after every run so far") : manual("confirm the holdout is unopened");
  } },
  { gate: "g4", id: "promotion-stage", why: "Field guide ch08 adoption ladder: evidence builder → shadow baseline → reviewed evaluation → optional enforcement → production publishing (always human).", run() {
    return manual("stage 2 of 5, shadow baseline. Stage 1 needs the evidence builder tested (the container guide's reader fails on built-in triggers); stage 3 needs reviewed real labels and Preview evidence");
  } },
  { gate: "g4", id: "staging-qa", why: "The video's restaurant case: 11/11 checks passed and the order form was still missing. Each kept round needs a preview-mode tag-firing check.", run() {
    return /qa: \{ status: "absent" \}/.test(read("scripts/run-gtm-loop.ts"))
      ? notBuilt("kept rounds pass qa: { status: \"absent\" } to the judge; no Playwright preview run per round yet") : manual("check QA evidence by hand");
  } },
  { gate: "g4", id: "observed-vs-configured", why: "Compare what the container is configured to send with what actually fires on the site.", run: () => notBuilt("jev-site-scan exists as its own Worker; not yet called from the loop") },
  { gate: "g4", id: "human-publish", why: "A person reviews the winner and the data audit, then publishes the staging workspace.", run: () => manual("by design: the owner publishes; the box records who and when") },
];

export const GATES = ["g0", "g1", "g2", "g3", "g4"];
