# Autoresearch in a Box

An FDE package for GTM Autoresearch. It maps the Karpathy loop and its outer AutoLoop
onto this repo: done-when checks by gate, an AutoLoop that reads every run ledger and
proposes a rewrite of the "Edit Strategy" section of `program.md` only, and a live SSE
run view. Sibling of Skills in a Box and DevOps in a Box.

## One command

```bash
npm ci                                  # repo root; the box uses the repo's own scorer via tsx
node box/cli/arb.mjs check all --why
node box/cli/arb.mjs autoloop --write   # proposals land in box/proof/program.<CLIENT>.proposed.md
node box/cli/arb.mjs replay content/gtm-templates/BLADE/loop-results/2026-04-29T143650.json
```

Set `ARB_URL` and `ARB_INGEST_TOKEN` and every event also streams to the Worker,
where `/` and `/run/` show it live over `/api/stream`. Set `ARB_RECORD` to append events as JSONL.

## How the video maps here

| Video | This repo |
| --- | --- |
| `train.py`, the one mutable file | `content/gtm-templates/<CLIENT>/seed/*.json` |
| scoring file the agent can't edit | `evals/eval_gtm_signal_quality.ts` (lock with `box/templates/claude-settings.json`) |
| `program.md` fixed rules | Constraints, Mutation Budget, Stop Conditions, weights table |
| `program.md` how to work | Edit Strategy, the only section AutoLoop may rewrite |
| `results.tsv` | `content/gtm-templates/<CLIENT>/loop-results/*.json` |
| AutoLoop | `box/autoloop/analyze.mjs` |
| "11/11 passed, form missing" | Jev container pipeline on each winner (reader, hard stops, audit), preview QA, jev-site-scan (G4) |

## Gates and the first run (main @ 62dfaa3): 11 pass, 10 fail, 2 manual, 4 not built

| Gate | What it proves | Result |
| --- | --- | --- |
| G0 Loop contract | one mutable file, fixed/how-to-work split, deterministic scorer, invariants in code, no publish | 5 / 5 pass |
| G1 Scorer locked | evals/ deny rule, winners re-score, program.md drives the loop, weights agree | 1 / 4 pass |
| G2 Ledger teaches | attempts recorded, stall stop, failure stop, manifest current | 2 / 5 pass |
| G3 AutoLoop | finds habits, scope limited to Edit Strategy, takes effect, owner approves | 2 / 4 pass, 1 not built |
| G4 Beyond the score | Jev lane: hard stops in policy, winner hard stops, audit not worse, reader sound, question set; shadow judge, staging QA, observed vs configured, human publishes | 1 pass, 3 fail, 2 manual, 3 not built |

Main findings: BLADE's 2026-04-29 run reverted 24 of 30 rounds in a row at 77.3% because
`pickStrategy()` kept choosing trigger quality, whose only error (a 4-event regex trigger)
needs 6 entity changes against a budget of 3. No reverted round records what it tried.
`parseProgram()` ignores Edit Strategy and Constraints, so program.md edits change nothing yet.

The Jev lane (`box/jev/`, the Jev container guide's reader and audit, copied unchanged): BLADE's
winner scores 77.3% but its high-severity audit findings rose 43→157, mostly consent NEEDED with no
consent types (AUD-CON-02 0→114). HRE shows the same pattern (6→28) and its winner added 2 opaque-code
entities. Both winners trip hard stops (consent touched, opaque code touched). `shadowPolicy()` has
none of the guide's container hard stops. The guide's reader flags GTM built-in triggers as unresolved.

The recorded run is `proof/2026-10-03-gtm-autoresearch.jsonl`.

## Deploy

```bash
cd box && npm install
npx wrangler d1 create autoresearch-in-a-box        # paste the id into wrangler.jsonc
npx wrangler d1 migrations apply autoresearch-in-a-box --remote
npx wrangler secret put ARB_INGEST_TOKEN
npm run deploy
```

## Layout

```
cli/arb.mjs            the CLI
checks/index.mjs       every check, by gate
checks/repo.mjs        reads clients, program.md sections, ledgers
checks/score.ts        calls the repo's scorer, prints JSON
autoloop/analyze.mjs   habits + Edit Strategy proposals + owner-only notes
jev/                   Jev container guide reader + audit (unchanged, see jev/SOURCE.md) and run.mjs
src/worker.js          Assets, /api/events, /api/stream (SSE), /api/status, cron
migrations/            D1 schema
site/page.html         guide + run view, built into public/ by site/build.mjs
proof/                 recorded runs and proposals
templates/             .claude/settings.json deny rule for evals/, CI workflow
templates/box.yml      CI workflow: copy to .github/workflows/ (check + autoloop, streamed to the Worker)
```

## License

MIT.
