# BLADE: changes only the owner can make

AutoLoop may not edit the scorer, the weights, the constraints or the loop code. These came out of the same evidence and need a person.

- scripts/run-gtm-loop.ts: count a revert as a regression, as the field guide says (ch04: MAX_REGRESSIONS = 3 consecutive reverts). Today regressionCount only moves when the working score drops, which a revert never causes.
- program.md + scripts/run-gtm-loop.ts: write per-dimension floors before the run (field guide ch02) and reject any candidate that crosses one, whatever the composite does.
- evals/: make consentSettings require at least one consent type per NEEDED tag, so the score agrees with AUD-CON-02.
- scripts/jev-shadow.ts: map the container guide's hard stops (consent touched, opaque code touched, unresolved refs, partial export) into shadowPolicy() as a versioned shadow change: recorded with reason codes, not enforced (field guide ch05).
