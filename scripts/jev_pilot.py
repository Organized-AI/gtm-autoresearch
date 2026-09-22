#!/usr/bin/env python3
"""Offline validation and scoring for a bounded Jev pilot package. Never calls a provider."""
from __future__ import annotations

import argparse, hashlib, json
from pathlib import Path

LABELS = {"pass", "fail", "insufficient"}
FUNCTIONS = {"evidenceSufficient", "trackingBehaviorPreserved"}
MAX_ROWS = 12

def canonical(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
def digest_text(value): return hashlib.sha256(value.encode("utf-8")).hexdigest()
def digest_bytes(value): return hashlib.sha256(value).hexdigest()
def parse_json(text): return json.loads(text, parse_constant=lambda value: fail(f"nonfinite JSON value: {value}"))
def read_json(path): return parse_json(path.read_text(encoding="utf-8"))
def read_jsonl(path): return [parse_json(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
def fail(message): raise ValueError(message)

def package_files(root, *, scoring=False):
    checksums = read_json(root / "checksums.json")
    if not isinstance(checksums, dict) or not checksums: fail("checksum inventory missing")
    for name, expected in checksums.items():
        if not isinstance(name, str) or "/" in name or not isinstance(expected, str) or len(expected) != 64: fail("invalid checksum inventory")
        path = root / name
        if not path.is_file() or digest_bytes(path.read_bytes()) != expected: fail(f"checksum mismatch: {name}")
    required = {"rubric.json", "pilot-inputs.jsonl", "manifest.json"} | ({"pilot-expected.jsonl"} if scoring else set())
    if not required <= set(checksums): fail("checksum inventory lacks required package files")
    return checksums

def validate_row(row, rubric_hash):
    if not isinstance(row, dict): fail("pilot row must be an object")
    if not isinstance(row.get("recordId"), str) or not isinstance(row.get("inputHash"), str): fail("pilot row identity missing")
    input_value = row.get("input")
    if not isinstance(input_value, dict) or set(input_value) != {"observation"}: fail("only input.observation may enter the judge")
    if not isinstance(row.get("canonicalInput"), str): fail("canonical input missing")
    try: parsed = parse_json(row["canonicalInput"])
    except json.JSONDecodeError as error: raise ValueError("canonical input is invalid JSON") from error
    if parsed != input_value: fail("canonical input does not exactly represent input")
    if digest_text(row["canonicalInput"]) != row["inputHash"]: fail("input hash mismatch")
    provenance = row.get("provenance")
    if not isinstance(provenance, dict) or provenance.get("split") != "train": fail("pilot accepts training rows only")
    observation = input_value["observation"]
    if not isinstance(observation, dict) or set(observation) != {"schemaVersion", "decisionTime", "synthetic", "facts", "cautions"}: fail("invalid bounded observation projection")
    if observation["schemaVersion"] != "synthetic-gtm-observation-v2" or observation["decisionTime"] != provenance.get("decisionTime"): fail("observation/provenance time identity mismatch")
    if row.get("deterministicReject") is not False: fail("deterministic rejects cannot be sent to the judge")
    if row.get("rubricHash", rubric_hash) != rubric_hash: fail("row rubric identity mismatch")

def preflight(root):
    root = Path(root).resolve(); package_files(root)
    manifest, rubric = read_json(root / "manifest.json"), read_json(root / "rubric.json")
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != "jev-pilot-package-v1": fail("unsupported pilot package")
    if not isinstance(rubric, dict) or rubric.get("status") != "seed" or rubric.get("preprocessingVersion") != "synthetic-gtm-observation-v2": fail("pilot requires a frozen synthetic seed rubric")
    functions=rubric.get("functions")
    if not isinstance(functions,dict) or set(functions)!=FUNCTIONS: fail("rubric must define exactly two functions")
    for function in functions.values():
        if not isinstance(function,dict) or not isinstance(function.get("description"),str) or not function["description"] or not isinstance(function.get("labels"),dict) or set(function["labels"])!=LABELS or not all(isinstance(value,str) and value for value in function["labels"].values()): fail("invalid rubric labels")
    rubric_hash = digest_text(canonical(rubric))
    if manifest.get("rubricHash") != rubric_hash: fail("manifest rubric identity mismatch")
    rows = read_jsonl(root / "pilot-inputs.jsonl")
    if not rows or len(rows) > MAX_ROWS: fail(f"pilot row cap is {MAX_ROWS}")
    record_ids, input_hashes = set(), set()
    for row in rows:
        validate_row(row, rubric_hash)
        if row["recordId"] in record_ids or row["inputHash"] in input_hashes: fail("duplicate pilot record or input")
        record_ids.add(row["recordId"]); input_hashes.add(row["inputHash"])
    declared = manifest.get("pilotObservations")
    if declared != len(rows) or manifest.get("maxAtomicEvaluations") != len(rows) * 2: fail("manifest row/evaluation count mismatch")
    return {"mode":"offline-preflight","providerCalls":0,"records":len(rows),"atomicEvaluationCap":len(rows)*2,"rubricHash":rubric_hash,"status":"ready-for-externally-authorized-execution-only","budgetNote":"Call cap is not a dollar cap; the native runtime exposes no per-call token/cost telemetry."}

def score(root, results_path):
    report = preflight(root); root = Path(root).resolve(); package_files(root, scoring=True)
    rubric_hash = report["rubricHash"]
    expected = {row["recordId"]: row for row in read_jsonl(root / "pilot-inputs.jsonl")}
    expected_rows=read_jsonl(root / "pilot-expected.jsonl"); expected_labels={}
    for label in expected_rows:
        if not isinstance(label,dict) or label.get("recordId") not in expected or label.get("recordId") in expected_labels or label.get("inputHash")!=expected[label.get("recordId")]["inputHash"] or label.get("rubricHash")!=rubric_hash: fail("invalid expected label identity")
        answers=label.get("expectedAnswers")
        if not isinstance(answers,dict) or set(answers)!=FUNCTIONS or any(value not in LABELS for value in answers.values()) or label.get("reviewStatus")!="unreviewed": fail("invalid expected labels")
        expected_labels[label["recordId"]]=answers
    if set(expected_labels)!=set(expected): fail("missing expected labels")
    results = read_jsonl(Path(results_path))
    seen, predictions, abstentions, errors = set(), [], [], []
    for result in results:
        if not isinstance(result, dict): fail("result must be an object")
        record_id = result.get("recordId")
        if record_id not in expected or record_id in seen: fail("unknown or duplicate result record")
        seen.add(record_id); row = expected[record_id]
        if result.get("inputHash") != row["inputHash"] or result.get("rubricHash") != rubric_hash: fail("result identity mismatch")
        status = result.get("status")
        if status == "success":
            answers = result.get("answers")
            if not isinstance(answers, dict) or set(answers) != FUNCTIONS or any(answer not in LABELS for answer in answers.values()): fail("invalid prediction answers")
            predictions.append({"recordId":record_id,"answers":answers})
        elif status == "abstained":
            if not isinstance(result.get("reason"), str) or "answers" in result: fail("invalid abstention")
            abstentions.append({"recordId":record_id,"reason":result["reason"]})
        elif status == "error":
            if not isinstance(result.get("reason"), str) or "answers" in result: fail("invalid error result")
            errors.append({"recordId":record_id,"reason":result["reason"]})
        else: fail("unknown result status")
    if seen != set(expected): fail("missing result records")
    confusion={name:{truth:{guess:0 for guess in LABELS} for truth in LABELS} for name in FUNCTIONS}
    for prediction in predictions:
        for name in FUNCTIONS: confusion[name][expected_labels[prediction["recordId"]][name]][prediction["answers"][name]]+=1
    agreement={name:{"matches":sum(confusion[name][label][label] for label in LABELS),"denominator":len(predictions),"unreviewedGeneratorLabels":True} for name in FUNCTIONS}
    insufficient=sum(1 for prediction in predictions for answer in prediction["answers"].values() if answer=="insufficient")
    return {**report,"mode":"offline-result-score","predictions":predictions,"abstentions":abstentions,"errors":errors,"predictionCount":len(predictions),"abstentionCount":len(abstentions),"errorCount":len(errors),"runtimeCoverage":{"completed":len(predictions),"denominator":len(expected)},"insufficientPredictionCount":insufficient,"confusion":confusion,"agreementWithUnreviewedGeneratorLabels":agreement,"accuracy":"unavailable: generator labels are unreviewed and are not calibration or human accuracy"}

def main():
    parser=argparse.ArgumentParser(description=__doc__); sub=parser.add_subparsers(dest="command",required=True)
    for name in ("preflight","score"):
        command=sub.add_parser(name); command.add_argument("--package",required=True)
        if name == "score": command.add_argument("--results",required=True)
    args=parser.parse_args(); value=preflight(args.package) if args.command=="preflight" else score(args.package,args.results)
    print(json.dumps(value,indent=2,ensure_ascii=False))
if __name__=="__main__": main()
