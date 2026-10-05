# Jev-GTM

A small, typed decision layer for GTM audits, in the style of [jev-style](https://github.com/lawrence3699/jev-style): a **state** (one audit finding), a **question** with fixed options, and **probabilities** back. The GTM Container Atlas uses it to suggest a decision for every finding. The reviewer still decides.

```
finding (state) ──▶ question pack ──▶ provider ──▶ probabilities ──▶ confidence band
                    finding-decision    Workers AI     fix / intended    confident ≥ 0.75
                                        (your Worker)  / ask_owner       leaning
                                                                         unsure < 0.40
```

## Files

| File | What it is |
|---|---|
| `questions/finding-decision.json` | The one question in use: fix, intended or ask the owner |
| `state.schema.json` | The finding shape Jev receives (built from the atlas report model) |
| `thresholds.json` | Confidence formula and the 0.75 / 0.40 bands |
| `client.mjs` | `judge(findings)`, `resolve()`, `prompt()`, `normalize()` for Node, Workers and agents |
| `examples/` | A real request and the response from the hosted atlas |

## Where Jev runs

Jev runs on Workers AI inside the atlas Worker (`/api/judge`, the `AI` binding in `wrangler.jsonc`), billed to the Cloudflare account that deploys it. People using the atlas set up nothing: the page sends every finding to Jev as soon as the audit is built.

`judge(findings)` with no options, for agents and scripts:

1. `JEV_URL` → your own atlas Worker's `/api/judge`
2. `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` → Workers AI directly
3. nothing set → the hosted atlas at `atlas.organizedai.vip` (rate limited)

## Honest limits

Workers AI reports probabilities from a general model; they are not calibrated on labelled GTM findings. Reviewer decisions collected in the atlas are the path to a calibrated Jev-GTM, and the question pack stays compatible with calibrated small models such as [jev-style](https://github.com/lawrence3699/jev-style).
