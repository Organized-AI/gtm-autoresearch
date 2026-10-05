# Jev-GTM

A small, typed decision layer for GTM audits, in the style of [jev-style](https://github.com/lawrence3699/jev-style): a **state** (one audit finding), a **question** with fixed options, and **probabilities** back. The GTM Container Atlas uses it to suggest a decision for every finding. The reviewer still decides.

```
finding (state) ──▶ question pack ──▶ provider ──▶ probabilities ──▶ confidence band
                    finding-decision    Workers AI     fix / intended    confident ≥ 0.75
                                        OpenRouter     / ask_owner       leaning
                                        Claude                           unsure < 0.40
                                        local jev-style
```

## Files

| File | What it is |
|---|---|
| `questions/finding-decision.json` | The one question in use: fix, intended or ask the owner |
| `state.schema.json` | The finding shape Jev receives (built from the atlas report model) |
| `thresholds.json` | Confidence formula and the 0.75 / 0.40 bands |
| `client.mjs` | `judge(findings)`, `resolve()`, `prompt()`, `normalize()` for Node, Workers and agents |
| `examples/` | A real request and the response from the hosted atlas |

## Zero config

`judge(findings)` with no options uses whatever the machine is already connected to:

1. `JEV_LOCAL_URL` → a local `jev-style serve`
2. `JEV_URL` → your own atlas Worker's `/api/judge`
3. `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` → Workers AI directly
4. `OPENROUTER_API_KEY` → OpenRouter
5. nothing set → the shared atlas at `atlas.organizedai.vip` (rate limited)

In the atlas page the same order applies: the hosted Worker's Workers AI, then an OpenRouter account connected in this browser (one-click sign-in, no key to paste), then Claude when the page runs inside Claude.

## Honest limits

Workers AI, OpenRouter and Claude report probabilities from a general model; they are not calibrated on labelled GTM findings. `jev-style` is a calibrated small model, but it has not been trained on GTM data either. Collecting reviewer decisions from the atlas is the path to a calibrated Jev-GTM.
