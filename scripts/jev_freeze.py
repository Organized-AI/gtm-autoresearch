#!/usr/bin/env python3
"""Create two offline Jev seed functions from a versioned rubric; never evaluate them."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from jev_align import AIFunction
from jev_align.models import BackendConfig, CandidateHistory, MulticlassCandidateSpec, RunState
from jev_align.persistence import RunStore

FUNCTION_NAMES = ("evidenceSufficient", "trackingBehaviorPreserved")


def stable(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value: object) -> str:
    return hashlib.sha256(stable(value).encode("utf-8")).hexdigest()


def rubric(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("status") != "seed":
        raise ValueError("rubric must be a seed object")
    if not all(isinstance(value.get(key), str) and value[key] for key in ("rubricVersion", "preprocessingVersion")):
        raise ValueError("rubric is missing version identities")
    functions = value.get("functions")
    if not isinstance(functions, dict) or set(functions) != set(FUNCTION_NAMES):
        raise ValueError("rubric must define exactly two atomic functions")
    for name in FUNCTION_NAMES:
        item = functions[name]
        if not isinstance(item, dict) or not isinstance(item.get("description"), str):
            raise ValueError(f"rubric function {name} is invalid")
        labels = item.get("labels")
        if not isinstance(labels, dict) or set(labels) != {"pass", "fail", "insufficient"} or not all(isinstance(text, str) and text for text in labels.values()):
            raise ValueError(f"rubric function {name} must define pass/fail/insufficient labels")
    return value


def write_seed(run: Path, *, name: str, description: str, labels: dict[str, str], provider: str, model: str, source_hash: str) -> dict[str, str]:
    candidate = MulticlassCandidateSpec(instructions=description, criteria=labels)
    state = RunState(
        run_id=name,
        source_path="offline-rubric.json",
        source_sha256=source_hash,
        selected_columns=["observation"],
        reflection_model="offline/no-reflection",
        metric_budget=0,
        concurrency=1,
        backend=BackendConfig(provider=provider, model=model, options={}),
        current_candidate=candidate,
        history=[CandidateHistory(round_number=1, candidate=candidate, decision="seed")],
    )
    store = RunStore(run)
    store.initialize(state)
    function = AIFunction.load(run)
    try:
        definition = function._definition
    finally:
        function.close()
    return {"path": str(run.resolve()), "definitionHash": digest(definition), "provider": provider, "model": model}


def freeze(*, rubric_path: Path, output: Path, provider: str, model: str) -> dict[str, object]:
    if output.exists():
        raise ValueError("output already exists; refusing to overwrite a frozen seed")
    if not provider or not model:
        raise ValueError("provider and model are required")
    source = rubric(rubric_path)
    source_hash = digest(source)
    output.mkdir(parents=True)
    functions = {
        name: write_seed(output / name, name=name, description=source["functions"][name]["description"], labels=source["functions"][name]["labels"], provider=provider, model=model, source_hash=source_hash)
        for name in FUNCTION_NAMES
    }
    manifest: dict[str, object] = {
        "status": "seed",
        "definitionHash": digest({"rubricHash": source_hash, "functions": {name: functions[name]["definitionHash"] for name in FUNCTION_NAMES}}),
        "requestedModel": model,
        "preprocessingVersion": source["preprocessingVersion"],
        "policyVersion": "tracking-shadow-policy-v1",
        "rubricVersion": source["rubricVersion"],
        "rubricHash": source_hash,
        "functions": functions,
    }
    manifest["manifestHash"] = digest(manifest)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rubric", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    print(json.dumps(freeze(rubric_path=args.rubric, output=args.output, provider=args.provider, model=args.model), indent=2))


if __name__ == "__main__":
    main()
