// AutoLoop: the outer loop. It reads every run ledger, looks for habits that
// repeat across rounds, and proposes a rewrite of one section of program.md:
// "Edit Strategy" (how to work). It never touches the evaluator, the weights,
// the constraints, the mutation budget or the stop conditions. Those are the
// fixed rules; a human owns them, the same way a human approves the checks.
import { clients, rows, sections, findSection, HOW_RE, weightsFromProgram, score, winningFor, read } from "../checks/repo.mjs";

const STALL = 3; // consecutive reverts on an unchanged container

// Same rule as pickStrategy() in scripts/run-gtm-loop.ts: lowest-scoring
// dimension that has an error, else the lowest-scoring dimension.
function pickTarget(dims) {
  const withErr = dims.filter((d) => d.errors.length).sort((a, b) => a.score - b.score);
  return (withErr[0] || [...dims].sort((a, b) => a.score - b.score)[0]).name;
}

// How many entity changes the target's errors need. Today this understands one
// shape: a CUSTOM_EVENT trigger flagged for a missing EQUALS filter whose regex
// lists N events. Fixing it means N EQUALS triggers plus re-pointing every tag
// that fires on the old one.
function changesNeeded(containerFile, dim) {
  const doc = JSON.parse(read(containerFile));
  const cv = doc.containerVersion || doc;
  let need = 0;
  const detail = [];
  for (const e of dim.errors) {
    const trig = (cv.trigger || []).find((t) => t.name === e.entity);
    const regex = trig?.customEventFilter?.find((f) => f.type === "MATCH_REGEX");
    if (!/EQUALS/.test(e.message) || !regex) { need += 1; detail.push(`${e.entity}: 1 change`); continue; }
    const events = (regex.parameter.find((x) => x.key === "arg1")?.value || "").split("|").filter(Boolean);
    const tags = (cv.tag || []).filter((t) => (t.firingTriggerId || []).includes(trig.triggerId)).map((t) => t.name);
    need += events.length + tags.length;
    detail.push(`${e.entity} matches ${events.length} events (${events.join(", ")}) and fires ${tags.length} tags (${tags.join(", ")})`);
  }
  return { need, detail };
}

export function analyze() {
  const habits = [];
  const blind = [];
  const proposals = [];

  for (const c of clients()) {
    const all = rows(c);
    if (!all.length) continue;
    const weights = weightsFromProgram(c.program);
    const budget = Number(c.program.match(/Max (\d+) entit/i)?.[1] || 3);
    const lines = [];

    // Blind spot: a revert that doesn't say what it tried can't teach anything.
    const reverts = all.filter((r) => r.action === "reverted");
    const described = reverts.filter((r) => r.strategy || r.operations || r.candidateDimensions);
    if (reverts.length) blind.push({ client: c.id, reverted: reverts.length, described: described.length });

    for (const L of c.ledgers) {
      // Habit 1: the loop keeps retrying the same target after it stopped moving.
      let best = { len: 0 }, cur = null;
      L.results.forEach((r, i) => {
        if (r.action !== "reverted") { cur = null; return; }
        const prev = L.results[i - 1];
        const same = prev && prev.action === "reverted" && JSON.stringify(r.dimensions) === JSON.stringify(prev.dimensions);
        if (cur && same) { cur.len++; cur.end = r.round; } else cur = { start: r.round, end: r.round, len: 1 };
        if (cur.len > best.len) best = { ...cur };
      });
      if (best.len < STALL) continue;

      const win = winningFor(c, L);
      const scored = win ? score(win, c.snap) : null;
      const h = {
        id: "same-target-stall", client: c.id, ledger: L.file,
        rounds: `${best.start}–${best.end}`, count: best.len, of: L.rounds,
        claim: `${best.len} of ${L.rounds} rounds reverted in a row on an unchanged container at ${(L.bestScore * 100).toFixed(1)}%. The loop's stop conditions never fired: reverts don't count as regressions, and the plateau stop needs 92%.`,
      };
      if (scored && !scored.error) {
        const target = pickTarget(scored.dimensions);
        const dim = scored.dimensions.find((d) => d.name === target);
        const gaps = scored.dimensions.map((d) => ({ name: d.name, gap: (1 - d.score) * d.weight })).sort((a, b) => b.gap - a.gap);
        const rank = gaps.findIndex((g) => g.name === target) + 1;
        const { need, detail } = changesNeeded(win, dim);
        h.target = target;
        h.targetGapRank = `${rank} of ${gaps.length}`;
        h.biggestGaps = gaps.slice(0, 3).map((g) => `${g.name} ${(g.gap * 100).toFixed(1)}pp`);
        h.need = need; h.budget = budget; h.detail = detail;
        h.claim += ` pickStrategy() is deterministic, so with the same scores it chose ${target} every round. Its only error needs ${need} entity changes against a budget of ${budget}: ${detail.join("; ")}. ${target} is gap #${rank}; the biggest are ${h.biggestGaps.join(", ")}.`;
        if (need > budget) lines.push(`Before targeting a dimension, count the entity changes its fix needs. If it needs more than the mutation budget (${budget}), skip it for this run, write it to the run notes for a human, and take the next dimension. (Evidence: ${c.id} ${L.file.split("/").pop()} rounds ${h.rounds}, ${target} needed ${need}.)`);
        lines.push(`After ${STALL} reverts in a row on the same target, switch to the dimension with the largest weighted gap (1 − score) × weight instead of the lowest raw score. (Evidence: same run; ${h.biggestGaps[0]} was never targeted.)`);
      }
      habits.push(h);
    }

    // Habit 2: the mutation provider went silent and rounds were burned on it.
    const silent = c.ledgers.map((L) => ({ L, n: L.results.filter((r) => r.action === "json_fail" && /no response/i.test(r.mutationSummary || "")).length })).filter((x) => x.n);
    const silentTotal = silent.reduce((a, x) => a + x.n, 0);
    if (silentTotal >= 3) {
      habits.push({
        id: "provider-silence", client: c.id, count: silentTotal, runs: silent.length,
        claim: `${silentTotal} rounds across ${silent.length} runs got no response from the mutation provider (${silent.map((x) => `${x.L.file.split("/").pop()}: ${x.n}`).join(", ")}). One run made no attempt at all.`,
      });
      lines.push(`Before round 0, send the mutation provider a one-line ping and stop the run if it doesn't answer, so a dead provider costs one call instead of five rounds. (Evidence: ${c.id}, ${silentTotal} silent rounds in ${silent.length} runs.)`);
    }

    if (lines.length) {
      const secs = sections(c.program);
      const how = findSection(secs, HOW_RE);
      if (how) proposals.push({ client: c.id, file: c.programFile, section: how, before: secs[how], add: lines });
    }
  }
  return { habits, blind, proposals };
}

// Rewrites only the How-to-work section; every other byte of program.md stays.
export function applyProposal(md, proposal) {
  const head = `## ${proposal.section}`;
  const i = md.indexOf(head);
  if (i < 0) throw new Error(`section not found: ${proposal.section}`);
  const next = md.indexOf("\n## ", i + head.length);
  const end = next < 0 ? md.length : next;
  const body = md.slice(i + head.length, end).replace(/\s+$/, "");
  const learned = `\n\n### Learned habits (AutoLoop, review before merging)\n\n${proposal.add.map((l) => `- ${l}`).join("\n")}\n`;
  return md.slice(0, i + head.length) + body + learned + md.slice(end);
}
