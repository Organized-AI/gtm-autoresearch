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

## Gates and the first run (main @ 62dfaa3): 13 pass, 11 fail, 3 manual, 5 not built

Every check is tied to a chapter of the field guide (guide.organizedai.vip/gtm-autoresearch).
Where the guide calls a rule a future gate (shadow mode, ch05-08), the check reports "not built", never "fail".

| Gate | What it proves | Result |
| --- | --- | --- |
| G0 Loop contract | one mutable file, fixed/how-to-work split, deterministic scorer, invariants in code, no publish | 5 / 5 pass |
| G1 Scorer locked and honest | evals/ deny rule, winners re-score, program.md drives the loop, weights agree, dimension floors, fresh snapshot | 1 / 6 pass |
| G2 Ledger teaches | attempts recorded, stall stop, failure stop, manifest current | 2 / 5 pass |
| G3 AutoLoop | finds habits, scope limited to Edit Strategy, takes effect, owner approves | 2 / 4 pass, 1 not built |
| G4 Beyond the score | shadow judge, frozen two-question contract, untouched holdout, promotion stage, container hard stops (shadow), winner hard stops, audit not worse, reader sound, broader quiz, staging QA, observed vs configured, human publishes | 3 pass, 2 fail, 3 manual, 4 not built |

Main findings: BLADE's 2026-04-29 run reverted 24 of 30 rounds in a row at 77.3% because
`pickStrategy()` kept choosing trigger quality, whose only error (a 4-event regex trigger)
needs 6 entity changes against a budget of 3. No reverted round records what it tried.
`parseProgram()` ignores Edit Strategy and Constraints, so program.md edits change nothing yet.

Where the field guide and the code disagree: ch01/ch04 say a revert increments the regression counter
(MAX_REGRESSIONS = 3 consecutive reverts), but the code only counts working-score drops; ch01 says
program.md's strategy order and constraints feed the prompt, but both are hardcoded; ch04 records the
first run as 2 kept, 3 reverted, while its ledger shows 3 kept, 0 reverted, 2 provider failures.
Also: 10 of 17 measurable kept rounds lowered a dimension (no floors), and both ads snapshots are partial and months old.

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
