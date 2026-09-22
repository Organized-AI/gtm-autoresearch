#!/usr/bin/env python3
"""Rebind the same frozen training inputs/expected labels to a revised seed rubric, offline."""
import argparse
import hashlib
import json
import tempfile
from pathlib import Path

import jev_pilot
from jev_pilot_execute import FUNCTIONS, LABELS, canonical, digest, input_preflight, read_json


def prepare_comparison(source: Path, rubric_path: Path, output: Path):
    if output.exists():
        raise ValueError("comparison output already exists; refusing overwrite")
    rows, old_hash, _ = input_preflight(source)
    inventory = read_json(source / "checksums.json")
    expected_bytes = (source / "pilot-expected.jsonl").read_bytes()
    if hashlib.sha256(expected_bytes).hexdigest() != inventory.get("pilot-expected.jsonl"):
        raise ValueError("source expected-label checksum mismatch")
    expected = jev_pilot.read_jsonl(source / "pilot-expected.jsonl")
    by_id = {r["recordId"]: r for r in rows}
    if len(expected) != len(rows) or {r.get("recordId") for r in expected} != set(by_id):
        raise ValueError("source labels do not match input identities")
    for label in expected:
        row = by_id[label["recordId"]]
        if (label.get("rubricHash") != old_hash or label.get("inputHash") != row["inputHash"]
                or label.get("reviewStatus") != "unreviewed" or label.get("provenance") != "synthetic_generator_rule_not_human_reviewed"
                or set(label.get("expectedAnswers", {})) != set(FUNCTIONS) or any(v not in LABELS for v in label["expectedAnswers"].values())):
            raise ValueError("source expected-label identity mismatch")
    rubric = read_json(rubric_path)
    new_hash = digest(rubric)
    if new_hash == old_hash:
        raise ValueError("comparison needs a distinct revised rubric")
    new_rows = [{**r, "rubricHash": new_hash} for r in rows]
    new_expected = [{**r, "rubricHash": new_hash} for r in expected]
    manifest = {"schemaVersion": "jev-pilot-package-v1", "rubricHash": new_hash,
                "pilotObservations": len(rows), "maxAtomicEvaluations": len(rows) * 2,
                "comparisonSource": {"rubricHash": old_hash, "inputSha256": inventory["pilot-inputs.jsonl"],
                    "expectedSha256": inventory["pilot-expected.jsonl"],
                    "scope": "same training inputs and unreviewed expected answers; only rubric identity changed"}}
    files = {"rubric.json": json.dumps(rubric, indent=2) + "\n", "manifest.json": json.dumps(manifest, indent=2) + "\n",
             "pilot-inputs.jsonl": "".join(canonical(r) + "\n" for r in new_rows),
             "pilot-expected.jsonl": "".join(canonical(r) + "\n" for r in new_expected)}
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent, prefix=".comparison-") as temp:
        stage = Path(temp) / "package"
        stage.mkdir()
        for name, contents in files.items(): (stage / name).write_text(contents, encoding="utf-8")
        checksums = {name: hashlib.sha256((stage / name).read_bytes()).hexdigest() for name in files}
        (stage / "checksums.json").write_text(json.dumps(checksums, indent=2) + "\n")
        jev_pilot.preflight(stage)
        stage.rename(output)
    return {"mode": "offline-comparison-preparation", "providerCalls": 0, "rows": len(rows),
            "rubricHash": new_hash, "output": str(output.resolve()), "canonicalInputsUnchanged": True,
            "expectedAnswersUnchanged": True, "labelReviewStatus": "unreviewed"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--rubric", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare_comparison(args.source, args.rubric, args.output), indent=2))
