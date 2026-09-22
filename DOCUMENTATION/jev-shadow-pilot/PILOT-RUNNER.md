# Offline pilot runner

`scripts/jev_pilot.py` validates a compiled `jev-pilot-package-v1` and scores externally supplied result artifacts. It never imports Jev, reads credentials, or calls a provider.

```sh
python3 scripts/jev_pilot.py preflight --package /path/to/pilot-package
python3 scripts/jev_pilot.py score --package /path/to/pilot-package --results /path/to/results.jsonl
```

Preflight verifies package checksums, seed-rubric identity, canonical UTF-8 input hashes, training-only provenance, exact input projection (`input.observation` only), uniqueness, deterministic-reject exclusion, and the default cap of 12 rows / 24 atomic evaluations. The scorer requires one exact result per record and separates successful predictions from explicit abstentions and errors. It rejects unknown, duplicate, missing, malformed, or identity-mismatched results.

The call cap is not a dollar cap. The native Jev API has no per-call request, token, or currency telemetry. A live run remains gated on an explicit parent-process call limit, provider-side spend cap, and independently recorded provider usage; this runner invents neither predictions nor price.
