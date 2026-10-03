# HRE: changes only the owner can make

AutoLoop may not edit the scorer, the weights, the constraints or the loop code. These came out of the same evidence and need a person.

- evals/: make consentSettings require at least one consent type per NEEDED tag, so the score agrees with AUD-CON-02.
- scripts/jev-shadow.ts: add the guide's container hard stops (consent touched, opaque code touched, unresolved refs, partial export) to shadowPolicy() ahead of the judge.
