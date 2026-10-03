// AutoLoop: the outer loop. It reads every run ledger, looks for habits that
// repeat across rounds, and proposes a rewrite of one section of program.md:
// "Edit Strategy" (how to work). It never touches the evaluator, the weights,
// the constraints, the mutation budget or the stop conditions. Those are the
// fixed rules; a human owns them, the same way a human approves the checks.
import { clients, rows, sections, findSection, HOW_RE, weightsFromProgram, score, winningFor, bestWinner, read } from "../checks/repo.mjs";
import { audit } from "../jev/run.mjs";

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

    // Habits 3-5: what the loop's keeps did to the Jev container audit. The
    // scorer rewarded these rounds; the guide's audit (code, no model) flags them.
    const owner = [];
    const win = bestWinner(c);
    if (win && c.tmpl) {
      const a = audit(c.tmpl), b = audit(win);
      const rose = (k) => (b.byCheck[k] || 0) - (a.byCheck[k] || 0);
      const name = win.split("/").pop();
      if (rose("AUD-CON-02") > 0) {
        habits.push({ id: "consent-without-types", client: c.id, count: rose("AUD-CON-02"), ledger: win,
          claim: `The winner sets consentStatus NEEDED on ${rose("AUD-CON-02")} tags without listing any consent type. The scorer's consent dimension counts that as 100%; the Jev container audit counts each one as high severity (AUD-CON-02), so high findings went ${a.counts.high}→${b.counts.high} while the score went up.` });
        lines.push(`When a tag gets consentStatus NEEDED, list the consent types it depends on in the same edit: ad_storage (and ad_user_data, ad_personalization) for ad pixels and conversion tags, analytics_storage for GA4. NEEDED with no types is a high-severity audit finding. (Evidence: ${c.id} ${name}, ${rose("AUD-CON-02")} tags.)`);
        owner.push(`evals/: make consentSettings require at least one consent type per NEEDED tag, so the score agrees with AUD-CON-02.`);
      }
      if (rose("AUD-OPQ-01") > 0) {
        habits.push({ id: "adds-opaque-code", client: c.id, count: rose("AUD-OPQ-01"), ledger: win,
          claim: `The loop added ${rose("AUD-OPQ-01")} Custom HTML tags or Custom JavaScript variables (AUD-OPQ-01 ${a.byCheck["AUD-OPQ-01"] || 0}→${b.byCheck["AUD-OPQ-01"]}). Opaque code is a hard stop in the Jev guide: Jev can't judge it and a person must read it.` });
        lines.push(`Don't add Custom HTML tags or Custom JavaScript variables. Use a built-in tag type or a gallery template; if neither fits, skip the change and note it for a human. (Evidence: ${c.id} ${name}, +${rose("AUD-OPQ-01")} opaque entities.)`);
      }
      const doc = JSON.parse(read(win)); const cv = doc.containerVersion || doc;
      const seen = {}; for (const t of cv.trigger || []) seen[t.name] = (seen[t.name] || 0) + 1;
      const dups = Object.keys(seen).filter((k) => seen[k] > 1);
      if (dups.length) {
        habits.push({ id: "duplicate-trigger", client: c.id, count: dups.length, ledger: win,
          claim: `The winner has ${dups.length} trigger name${dups.length > 1 ? "s" : ""} used twice (${dups.join(", ")}); one copy fires no tag. Unused triggers went ${a.byCheck["AUD-TRG-02"] || 0}→${b.byCheck["AUD-TRG-02"] || 0}.` });
        lines.push(`Before adding a trigger, look for an existing trigger with the same name or the same filter and reuse it. (Evidence: ${c.id} ${name}, duplicate ${dups.join(", ")}.)`);
      }
    }
    owner.push(`scripts/jev-shadow.ts: add the guide's container hard stops (consent touched, opaque code touched, unresolved refs, partial export) to shadowPolicy() ahead of the judge.`);

    if (lines.length) {
      const secs = sections(c.program);
      const how = findSection(secs, HOW_RE);
      if (how) proposals.push({ client: c.id, file: c.programFile, section: how, before: secs[how], add: lines, owner: [...new Set(owner)] });
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
