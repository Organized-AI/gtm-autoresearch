# GTM Container Mutation Policy

A GTM export is the structural baseline for an optimization run. The system does not construct a canonical container document or normalize a customer export into one. Every candidate starts as a deep clone of the selected export:

```ts
applyOperations(deepClone(baseline), operations)
```

This preserves export-specific fields such as custom templates, server-side clients, fingerprints, and future GTM fields that the optimizer does not understand.

## Mutation boundary

The mutation provider returns an operations object only. `scripts/gtm-container-mutations.ts` validates and applies it.

- New tags, triggers, variables, and folders receive their IDs and account/container identity from deterministic code.
- A model cannot supply IDs, account/container IDs, or fingerprints for additions.
- Existing tags can change only `name`, `parameter`, `firingTriggerId`, `blockingTriggerId`, `parentFolderId`, `consentSettings`, `tagFiringOption`, or `notes`.
- Existing triggers, variables, folders, and unknown fields are retained byte-for-byte at the value level unless a supported operation adds an entity.
- The validator rejects removal, duplicate IDs, unexpected additions, changed top-level/container metadata, missing trigger or folder references, and newly introduced unresolved variable references.

The real HRE and BLADE exports are compatibility fixtures. They demonstrate shapes the engine must preserve; they do not define the schema for every GTM container.

## Decision and execution boundaries

The deterministic validator runs before scoring. The score decides whether a valid candidate is kept or reverted.

[Jev](https://guide.organizedai.vip/jev) belongs after deterministic validation as a semantic-risk and evidence judge. It receives the operation list, structural diff, evaluator result, and candidate evidence. It does not generate JSON, repair a rejected candidate, allocate IDs, or decide the keep/revert policy. [jev-align](https://github.com/sutro-sh/jev-align) is suitable for offline calibration of that judge, not as a runtime mutation dependency.

[OpenShell](https://github.com/NVIDIA/OpenShell) belongs around runtime workers when they are deployed: filesystem scope, process allowlists, network rules, and credential isolation. Mutation and judge workers should have no GTM management credentials or publishing authority. OpenShell does not decide candidate quality or replace the loop's keep/revert rule.

## Verification

Run the deterministic policy tests and the structural evaluator:

```bash
npm test
npm run typecheck
npm run eval:gtm -- content/gtm-templates/BLADE/seed/blade-sgtm.json
```
