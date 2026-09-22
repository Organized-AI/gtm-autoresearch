#!/usr/bin/env python3
"""Read-only local GTM/Jev run viewer. Never starts evaluation or reads credentials."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import math
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

try:
    from jev_pilot import parse_json as strict_parse_json
    from jev_pilot_execute import input_preflight
except ModuleNotFoundError:  # Imported as scripts.gtm_run_view by tests or tooling.
    from scripts.jev_pilot import parse_json as strict_parse_json
    from scripts.jev_pilot_execute import input_preflight

ROOT = Path(__file__).resolve().parents[1]
FUNCTIONS = ("evidenceSufficient", "trackingBehaviorPreserved")
LABELS = {"pass", "fail", "insufficient"}
MAX_BYTES = 8_000_000


def read_json(path: Path):
    data = bounded_bytes(path, "artifact")
    return strict_parse_json(data.decode("utf-8"))


def bounded_bytes(path: Path, name: str):
    with path.open("rb") as handle:
        data = handle.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError(f"{name} too large")
    return data


def journal_rows(path: Path):
    raw = bounded_bytes(path, "journal")
    # A writer may be between write and newline; only render durable full lines.
    lines = raw.split(b"\n")[:-1]
    return [strict_parse_json(line.decode("utf-8")) for line in lines if line.strip()]


def journal_has_unterminated_tail(path: Path):
    data = bounded_bytes(path, "journal")
    return bool(data) and not data.endswith(b"\n")


def nonempty_string(value):
    return isinstance(value, str) and bool(value)


def expected_label_rows(package: Path):
    checksums = read_json(package / "checksums.json")
    if not isinstance(checksums, dict):
        raise ValueError("checksum inventory missing")
    expected_checksum = checksums.get("pilot-expected.jsonl")
    if not isinstance(expected_checksum, str) or len(expected_checksum) != 64:
        raise ValueError("expected-label checksum missing")
    raw = bounded_bytes(package / "pilot-expected.jsonl", "expected labels")
    if hashlib.sha256(raw).hexdigest() != expected_checksum:
        raise ValueError("expected-label checksum mismatch")
    return [strict_parse_json(line.decode("utf-8")) for line in raw.splitlines() if line.strip()]


def executable_package_rows(package: Path):
    # Bound only the executable package bytes before using the executor's
    # label-blind validator; no holdout, validation, or expected-label bytes
    # are opened here.
    for name in ("checksums.json", "rubric.json", "pilot-inputs.jsonl", "manifest.json"):
        bounded_bytes(package / name, name)
    return input_preflight(package)


def writer_active(path: Path):
    if not path.exists():
        return False
    with path.open("r") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    return False


def text(value, limit=200):
    return value[:limit] if isinstance(value, str) else None


def number(value):
    return value if type(value) in (int, float) and math.isfinite(value) and value >= 0 else None


def metadata(value):
    value = value if isinstance(value, dict) else {}
    usage = value.get("usage", {})
    probabilities = value.get("probabilities", {})
    return {
        "reportedModel": text(value.get("reportedModel")),
        "confidence": number(value.get("confidence")),
        "probabilities": {k: number(v) for k, v in probabilities.items() if k in LABELS} if isinstance(probabilities, dict) else {},
        "usage": {k: number(usage.get(k)) for k in ("input_tokens", "output_tokens")} if isinstance(usage, dict) else {},
        "latencyMs": number(value.get("latencyMs")), "requestId": text(value.get("requestId")),
    }


def snapshot(run_dir: Path, package: Path, *, include_comparison_identity=False):
    notices = ["Read-only viewer. Replay does not send requests.",
               "The optimization loop diagram is architecture; this journal records the Jev shadow pilot."]
    value = {"schemaVersion": "gtm-run-view-v1", "source": "recorded-journal",
             "run": {"status": "unavailable", "active": False}, "score": {"available": False},
             "events": [], "records": [], "notices": notices}
    path = run_dir / "journal.jsonl"
    try:
        events = journal_rows(path)
        has_unterminated_tail = journal_has_unterminated_tail(path)
        if not events or not isinstance(events[0], dict) or events[0].get("event") != "run-started":
            raise ValueError("journal header unavailable")
        header = events[0]
        if not all(nonempty_string(header.get(key)) for key in ("runId", "rubricHash", "seedManifestHash", "configHash", "provider", "model", "transport")):
            raise ValueError("journal header identity unavailable")
        header_inputs = header.get("inputs")
        if not isinstance(header_inputs, list):
            raise ValueError("invalid run inputs")
        inputs = {}
        for item in header_inputs:
            if not isinstance(item, dict) or not nonempty_string(item.get("recordId")) or not nonempty_string(item.get("inputHash")) or item["recordId"] in inputs:
                raise ValueError("invalid run inputs")
            inputs[item["recordId"]] = item["inputHash"]
        if not inputs or len(inputs) > 12:
            raise ValueError("invalid run inputs")
        starts, finishes, completed = {}, {}, {}
        visible = [{"index": 0, "kind": "run-started"}]
        for i, event in enumerate(events[1:], 1):
            record_id, kind = event.get("recordId"), event.get("event")
            if (record_id not in inputs or event.get("runId") != header.get("runId")
                    or event.get("inputHash") != inputs[record_id]
                    or event.get("rubricHash") != header.get("rubricHash")
                    or event.get("seedManifestHash") != header.get("seedManifestHash")
                    or event.get("provider") != header.get("provider") or event.get("model") != header.get("model")):
                raise ValueError("journal identity mismatch")
            key = (record_id, event.get("function"))
            if kind in {"attempt-started", "attempt-finished"}:
                attempt = event.get("atomicAttempt")
                if key[1] not in FUNCTIONS or type(attempt) is not int or not 1 <= attempt <= 24:
                    raise ValueError("invalid attempt")
                if record_id in completed:
                    raise ValueError("attempt after completed record")
                if kind == "attempt-started":
                    if key in starts or attempt in [v["atomicAttempt"] for v in starts.values()]:
                        raise ValueError("duplicate attempt")
                    starts[key] = event
                else:
                    if key not in starts or key in finishes or starts[key]["atomicAttempt"] != attempt:
                        raise ValueError("unreserved or duplicate response")
                    if event.get("status") not in {"success", "error"} or event.get("status") == "success" and event.get("answer") not in LABELS:
                        raise ValueError("invalid response")
                    finishes[key] = event
            elif kind == "record-finished":
                if record_id in completed or event.get("status") not in {"success", "error", "abstained"}:
                    raise ValueError("invalid completed record")
                answers = event.get("answers", {})
                if event["status"] == "success":
                    if set(answers) != set(FUNCTIONS) or any(finishes.get((record_id, name), {}).get("status") != "success" or finishes[(record_id, name)].get("answer") != answers[name] for name in FUNCTIONS):
                        raise ValueError("record does not match atomic responses")
                elif "answers" in event or not isinstance(event.get("reason"), str):
                    raise ValueError("invalid non-success record")
                completed[record_id] = event
            else:
                raise ValueError("unknown journal event")
            visible.append({"index": i, "kind": kind, "recordId": record_id,
                            "function": text(event.get("function")), "attempt": event.get("atomicAttempt"),
                            "status": text(event.get("status")), "answer": event.get("answer") if event.get("answer") in LABELS else None,
                            "reason": "Evaluation failed; inspect the local journal." if event.get("reason") else None,
                            "metadata": metadata(event.get("providerMetadata"))})
        active = writer_active(run_dir / "journal.jsonl.lock")
        complete = len(completed) == len(inputs)
        if complete and not active and has_unterminated_tail:
            raise ValueError("completed journal has an unterminated tail")
        provider_metadata = [metadata(e.get("providerMetadata")) for e in finishes.values() if e.get("status") == "success"]
        usage = {k: sum(m["usage"].get(k) or 0 for m in provider_metadata) for k in ("input_tokens", "output_tokens")}
        errors = sum(e.get("status") == "error" for e in finishes.values())
        value["run"] = {"id": text(header.get("runId")), "model": text(header.get("model")),
            "provider": text(header.get("provider")), "transport": text(header.get("transport")),
            "status": "in_progress" if active else "complete" if complete else "partial", "active": active,
            "totalRows": len(inputs), "completedRows": len(completed), "attemptsStarted": len(starts),
            "attemptsFinished": len(finishes), "errors": errors, "attemptCap": 24, "usage": usage,
            "journalUpdatedAt": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()}
        value["events"] = visible
        value["records"] = [{"recordId": rid, "status": event["status"],
            "answers": {k: v for k, v in event.get("answers", {}).items() if event["status"] == "success" and k in FUNCTIONS and v in LABELS},
            "providerEvaluations": {k: metadata(v) for k, v in event.get("providerEvaluations", {}).items() if k in FUNCTIONS}}
            for rid, event in completed.items()]
        if errors:
            notices.append("Usage includes successful retained responses only; failed-request usage is unavailable.")
        # Labels are visible only after a complete, independently scored run.
        if complete and not active and (run_dir / "score.json").is_file():
            try:
                score = read_json(run_dir / "score.json")
                if not isinstance(score, dict) or not isinstance(score.get("predictions"), list):
                    raise ValueError("invalid score")
                predictions = {}
                for prediction in score["predictions"]:
                    if not isinstance(prediction, dict) or not nonempty_string(prediction.get("recordId")) or prediction["recordId"] in predictions or not isinstance(prediction.get("answers"), dict) or set(prediction["answers"]) != set(FUNCTIONS) or any(answer not in LABELS for answer in prediction["answers"].values()):
                        raise ValueError("invalid score prediction")
                    predictions[prediction["recordId"]] = prediction["answers"]
                expected_predictions = {r["recordId"]: r["answers"] for r in value["records"] if r["status"] == "success"}
                if score["rubricHash"] != header["rubricHash"] or predictions != expected_predictions:
                    raise ValueError("stale score")
                package_rows, package_rubric_hash, rubric = executable_package_rows(package)
                package_inputs = {row["recordId"]: row["inputHash"] for row in package_rows}
                if package_rubric_hash != header["rubricHash"] or package_inputs != inputs:
                    raise ValueError("package rubric identity mismatch")
                expected = {}
                for label in expected_label_rows(package):
                    if not isinstance(label, dict) or not nonempty_string(label.get("recordId")) or label["recordId"] in expected:
                        raise ValueError("duplicate or invalid expected label")
                    expected[label["recordId"]] = label
                if set(expected) != set(inputs) or any(r.get("inputHash") != inputs[rid] or r.get("rubricHash") != header["rubricHash"] or r.get("reviewStatus") != "unreviewed" or r.get("provenance") != "synthetic_generator_rule_not_human_reviewed" or r.get("labelVersion") != "synthetic-observability-labels-v1" or r.get("deterministicReject") is not False or set(r.get("expectedAnswers", {})) != set(FUNCTIONS) or any(v not in LABELS for v in r["expectedAnswers"].values()) for rid, r in expected.items()):
                    raise ValueError("expected-label identity mismatch")
                matches = {name: 0 for name in FUNCTIONS}
                paired, insufficient = 0, 0
                for record in value["records"]:
                    labels = expected[record["recordId"]]
                    record.update(expectedAnswers=labels["expectedAnswers"], reasonCode=text(labels.get("reasonCode")))
                    if record["status"] != "success": continue
                    paired += record["answers"] == labels["expectedAnswers"]
                    insufficient += sum(v == "insufficient" for v in record["answers"].values())
                    for name in FUNCTIONS: matches[name] += record["answers"][name] == labels["expectedAnswers"][name]
                value["score"] = {"available": True, "agreement": {name: {"matches": n, "denominator": len(predictions)} for name, n in matches.items()},
                                  "pairedMatches": paired, "insufficientAnswers": insufficient, "labelStatus": "unreviewed synthetic generator labels"}
                if include_comparison_identity:
                    value["_comparisonIdentity"] = {
                        "rubricHash": header["rubricHash"], "rubricVersion": text(rubric.get("rubricVersion")),
                        "inputs": inputs,
                        "expectedAnswers": {record_id: expected[record_id]["expectedAnswers"] for record_id in inputs},
                    }
            except (OSError, ValueError, KeyError, TypeError):
                notices.append("Scoring unavailable: matching completed score and expected labels are required.")
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        value.update(run={"status": "unavailable", "active": False}, events=[], records=[])
        notices.append("Run journal is missing or invalid. No run activity is inferred.")
    return value


def fraction(matches, denominator):
    return {"matches": matches, "denominator": denominator}


def comparison_metrics(snapshot_value):
    score = snapshot_value["score"]
    records = snapshot_value["records"]
    total_rows = snapshot_value["run"].get("totalRows")
    successful = [record for record in records if record.get("status") == "success"]
    expected = snapshot_value["_comparisonIdentity"]["expectedAnswers"]
    predictions = {record["recordId"]: record["answers"] for record in successful}

    def tracking_retention(label):
        selected = [record_id for record_id, answers in expected.items() if answers["trackingBehaviorPreserved"] == label]
        return fraction(sum(record_id in predictions and predictions[record_id]["trackingBehaviorPreserved"] == label for record_id in selected), len(selected))

    insufficient = [record_id for record_id, answers in expected.items() if answers["evidenceSufficient"] == "insufficient" and answers["trackingBehaviorPreserved"] == "insufficient"]
    evidence_insufficient = [record_id for record_id, answers in expected.items() if answers["evidenceSufficient"] == "insufficient"]
    tracking_insufficient = [record_id for record_id, answers in expected.items() if answers["trackingBehaviorPreserved"] == "insufficient"]
    return {
        "rubric": {"id": snapshot_value["_comparisonIdentity"]["rubricHash"], "version": snapshot_value["_comparisonIdentity"]["rubricVersion"]},
        "runtimeCoverage": {"successfulPairs": len(successful), "completedRows": len(records), "denominator": total_rows,
                            "attemptsFinished": snapshot_value["run"].get("attemptsFinished"), "errors": snapshot_value["run"].get("errors")},
        "agreement": {name: score["agreement"][name] for name in FUNCTIONS} | {"paired": fraction(score["pairedMatches"], score["agreement"][FUNCTIONS[0]]["denominator"])},
        "trackingRetention": {"expectedFail": tracking_retention("fail"), "expectedPass": tracking_retention("pass")},
        "expectedInsufficient": {
            "evidenceSufficient": fraction(sum(record_id in predictions and predictions[record_id]["evidenceSufficient"] == "insufficient" for record_id in evidence_insufficient), len(evidence_insufficient)),
            "trackingBehaviorPreserved": fraction(sum(record_id in predictions and predictions[record_id]["trackingBehaviorPreserved"] == "insufficient" for record_id in tracking_insufficient), len(tracking_insufficient)),
            "bothQuestionMatches": fraction(sum(record_id in predictions and predictions[record_id] == expected[record_id] for record_id in insufficient), len(insufficient)),
        },
    }


def compare_completed_snapshots(current, baseline):
    unavailable = {"available": False, "reason": "Baseline comparison requires two complete, unlocked, score-verified recorded journals."}
    for candidate in (current, baseline):
        if candidate["run"].get("status") != "complete" or candidate["run"].get("active") or not candidate["score"].get("available") or "_comparisonIdentity" not in candidate:
            return unavailable
    current_identity, baseline_identity = current["_comparisonIdentity"], baseline["_comparisonIdentity"]
    if current_identity["rubricHash"] == baseline_identity["rubricHash"]:
        return {"available": False, "reason": "Baseline comparison requires distinct frozen rubric identities."}
    if current_identity["inputs"] != baseline_identity["inputs"]:
        return {"available": False, "reason": "Baseline comparison withheld: record ID and input-hash correspondence did not verify."}
    if current_identity["expectedAnswers"] != baseline_identity["expectedAnswers"]:
        return {"available": False, "reason": "Baseline comparison withheld: expected answers changed between frozen packages."}
    return {"available": True, "labelStatus": "unreviewed synthetic generator labels", "baseline": {"runId": baseline["run"].get("id"), **comparison_metrics(baseline)}, "current": {"runId": current["run"].get("id"), **comparison_metrics(current)}}


def parse_allowed_origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname
            or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment
            or any(c.isspace() for c in value)):
        raise argparse.ArgumentTypeError("expected an exact http(s) origin without a path")
    try:
        parsed.port
    except ValueError as error:
        raise argparse.ArgumentTypeError("invalid origin port") from error
    return value


def handler_for(run_dir: Path, package: Path, allowed_origins=(), baseline_run_dir=None, baseline_package=None):
    if (baseline_run_dir is None) != (baseline_package is None):
        raise ValueError("baseline run directory and package must be supplied together")
    configured_origins = {parse_allowed_origin(origin) for origin in allowed_origins}
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            host = self.headers.get("Host", "")
            origin = self.headers.get("Origin")
            origins = configured_origins | {f"http://127.0.0.1:{self.server.server_port}", f"http://localhost:{self.server.server_port}"}
            matching_origins = {item for item in origins if urlsplit(item).netloc == host}
            if not matching_origins or origin and origin not in matching_origins:
                self.send_error(403); return
            route = urlsplit(self.path)
            static = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"), "/styles.css": ("styles.css", "text/css")}
            for family, weights in (("jetbrains-mono", (400, 500, 600, 700, 800)), ("inter", (400, 500, 600, 700))):
                for weight in weights:
                    name = f"fonts/{family}-{weight}.ttf"
                    static[f"/{name}"] = (name, "font/ttf")
            if route.query:
                self.send_error(404); return
            if route.path == "/api/state":
                state = snapshot(run_dir, package, include_comparison_identity=baseline_run_dir is not None)
                if baseline_run_dir is not None:
                    baseline = snapshot(baseline_run_dir, baseline_package, include_comparison_identity=True)
                    state["comparison"] = compare_completed_snapshots(state, baseline)
                    baseline.pop("_comparisonIdentity", None)
                state.pop("_comparisonIdentity", None)
                body = json.dumps(state, allow_nan=False).encode()
                mime = "application/json"
            elif route.path in static:
                name, mime = static[route.path]
                try: body = (ROOT / "dashboard" / name).read_bytes()
                except OSError: self.send_error(404); return
            else:
                self.send_error(404); return
            self.send_response(200)
            self.send_header("Content-Type", mime + "; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
            self.end_headers(); self.wfile.write(body)

        def log_message(self, *_args): pass
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--package", required=True, type=Path)
    parser.add_argument("--baseline-run-dir", type=Path,
                        help="Completed, unlocked recorded baseline journal for a verified comparison")
    parser.add_argument("--baseline-package", type=Path,
                        help="Frozen package matching --baseline-run-dir")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--allow-origin", action="append", default=[], type=parse_allowed_origin,
                        help="Exact additional browser origin for a trusted private reverse proxy; repeatable")
    args = parser.parse_args()
    if (args.baseline_run_dir is None) != (args.baseline_package is None):
        parser.error("--baseline-run-dir and --baseline-package must be supplied together")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(
        args.run_dir.resolve(), args.package.resolve(), args.allow_origin,
        args.baseline_run_dir.resolve() if args.baseline_run_dir else None,
        args.baseline_package.resolve() if args.baseline_package else None,
    ))
    print(f"Read-only GTM run viewer: http://127.0.0.1:{server.server_port}", flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__ == "__main__": main()
