# Phase 1 complete

`buildEvidence` creates stable hashes for complete baseline/candidate exports, operation lists, ID-based entity diffs, scores, validation, snapshot state, QA state, and frozen definition identity. `writeEvidence` retains reconstruction artifacts locally in ignored `shadow-results/` directories. `compactJudgeInput` excludes labels, legacy outcomes, and full source/script text.

Verified using BLADE web/server compatibility tests and synthetic evidence cases. No live QA or post-mutation measurement is claimed.
