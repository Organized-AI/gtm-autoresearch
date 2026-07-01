# Track Lab Integration

`gtm-autoresearch` is the flagship scenario in **Track Lab**, the public demo/eval harness for
the Organized AI Tracking Suite: `github.com/Organized-AI/organized-tracking`.

Track Lab's "S7 — Autoresearch loop" scenario replays this repo's real nightly loop
(`scripts/run-gtm-loop.ts`, the 12-dimension scorer in `evals/eval_gtm_signal_quality.ts`) as a
round-by-round agent log — score → mutate via Claude → validate → keep/revert — next to Track
Lab's other scenario (a Meta/GTM/Stape tracking audit), so a visitor can watch both the **agent
mechanics** (what Claude did) and the **domain outcome** (what happened to the score) for the
same kind of run.

The demo currently ships with an illustrative round-by-round breakdown that is consistent with
this repo's actual first-run aggregate (5 rounds, 84.3% → 91.2%, 2 kept / 3 reverted — see the
root `README.md` "Current gaps" table) but is not yet wired to the literal recorded log under
`DOCUMENTATION/loops/gtm-autoresearch/loop-results/`.

**What Track Lab does NOT do:**
- Reimplement the 12-dimension scorer — it only ever reads this repo's output.
- Re-specify the SQLite correlation engine in `DOCUMENTATION/schema-design-correlation-engine.md` —
  that's this repo's own roadmap item. Once it ships, Track Lab's adapter repoints from the
  static loop-results JSON to live `experiments.sqlite` queries — same envelope, new source.

Full integration plan: `organized-tracking/docs/track-lab/gtm-autoresearch-integration.md`
