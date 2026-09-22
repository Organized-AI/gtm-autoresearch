import hashlib
import http.client
import importlib.util
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("gtm_run_view", ROOT / "scripts/gtm_run_view.py")
view = importlib.util.module_from_spec(spec)
spec.loader.exec_module(view)


class RunViewTest(unittest.TestCase):
    def canonical(self, value):
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

    def digest(self, value):
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def write_checksums(self, root):
        names = ["rubric.json", "pilot-inputs.jsonl", "manifest.json", "pilot-expected.jsonl"]
        if (root / "unrelated-sentinel.json").is_file(): names.append("unrelated-sentinel.json")
        (root / "checksums.json").write_text(json.dumps({name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in names}))

    def fixture(self, root, complete=True):
        labels = {"pass": "pass", "fail": "fail", "insufficient": "insufficient"}
        rubric = {"rubricVersion": "synthetic-tracking-assessment-test", "status": "seed", "preprocessingVersion": "synthetic-gtm-observation-v2", "functions": {name: {"description": name, "labels": labels} for name in view.FUNCTIONS}}
        rubric_hash = self.digest(self.canonical(rubric))
        observation = {"schemaVersion": "synthetic-gtm-observation-v2", "decisionTime": "2026-01-01T00:00:00.000Z", "synthetic": True, "facts": {}, "cautions": []}
        input_value = {"observation": observation}
        canonical_input = self.canonical(input_value)
        input_hash = self.digest(canonical_input)
        row = {"recordId": "one", "inputHash": input_hash, "rubricHash": rubric_hash, "input": input_value, "canonicalInput": canonical_input, "provenance": {"split": "train", "decisionTime": observation["decisionTime"]}, "deterministicReject": False}
        manifest = {"schemaVersion": "jev-pilot-package-v1", "rubricHash": rubric_hash, "pilotObservations": 1, "maxAtomicEvaluations": 2}
        label = {"recordId": "one", "inputHash": input_hash, "rubricHash": rubric_hash, "reviewStatus": "unreviewed", "provenance": "synthetic_generator_rule_not_human_reviewed", "labelVersion": "synthetic-observability-labels-v1", "deterministicReject": False, "expectedAnswers": {name: "pass" for name in view.FUNCTIONS}, "reasonCode": "control", "generatorTruth": "DO_NOT_EXPOSE"}
        (root / "rubric.json").write_text(json.dumps(rubric))
        (root / "pilot-inputs.jsonl").write_text(json.dumps(row) + "\n")
        (root / "manifest.json").write_text(json.dumps(manifest))
        (root / "pilot-expected.jsonl").write_text(json.dumps(label) + "\n")
        self.write_checksums(root)
        header = {"event": "run-started", "runId": "run", "rubricHash": rubric_hash, "seedManifestHash": "seed", "configHash": "config", "provider": "cloudflare", "model": "typesafe/jev", "transport": "cloudflare-direct-v1", "inputs": [{"recordId": "one", "inputHash": input_hash}]}
        base = {k: v for k, v in header.items() if k not in {"event", "inputs", "transport"}}
        base.update(recordId="one", inputHash=input_hash)
        events = [header]
        for n, name in enumerate(view.FUNCTIONS, 1):
            attempt = {**base, "function": name, "atomicAttempt": n, "event": "attempt-started"}
            events.append(attempt)
            if not complete: break
            events.append({**attempt, "event": "attempt-finished", "status": "success", "answer": "pass", "providerMetadata": {"reportedModel": "jev-1.13.0", "confidence": .8, "probabilities": {"pass": .9, "fail": .1, "insufficient": 0}, "usage": {"input_tokens": 10, "output_tokens": 2}, "rawToken": "DO_NOT_EXPOSE", "requestId": f"request-{n}"}})
        answers = {name: "pass" for name in view.FUNCTIONS}
        if complete: events.append({**base, "event": "record-finished", "status": "success", "answers": answers, "rawObservation": {"secret": "DO_NOT_EXPOSE"}})
        (root / "journal.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events))
        (root / "score.json").write_text(json.dumps({"rubricHash": rubric_hash, "predictions": [{"recordId": "one", "answers": answers}]}))
        return events

    def test_completed_snapshot_derives_metrics_and_excludes_raw_fields(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.fixture(root)
            result = view.snapshot(root, root)
            self.assertEqual(result["run"]["status"], "complete")
            self.assertEqual(result["run"]["usage"], {"input_tokens": 20, "output_tokens": 4})
            self.assertEqual(result["score"]["pairedMatches"], 1)
            self.assertNotIn("DO_NOT_EXPOSE", json.dumps(result))

    def test_partial_tail_never_reads_expected_labels_or_fakes_activity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.fixture(root, complete=False)
            with (root / "journal.jsonl").open("a") as file: file.write('{"event":')
            original = view.journal_rows
            def read(path):
                self.assertEqual(path.name, "journal.jsonl")
                return original(path)
            with patch.object(view, "journal_rows", side_effect=read):
                result = view.snapshot(root, root)
            self.assertEqual(result["run"]["status"], "partial")
            self.assertFalse(result["run"]["active"])
            self.assertFalse(result["score"]["available"])
            self.assertEqual(len(result["events"]), 2)

    def test_running_writer_does_not_read_labels_even_when_score_exists(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.fixture(root, complete=False)
            with patch.object(view, "writer_active", return_value=True):
                result = view.snapshot(root, root)
            self.assertEqual(result["run"]["status"], "in_progress")
            self.assertTrue(result["run"]["active"])
            self.assertFalse(result["score"]["available"])

    def test_missing_corrupt_and_duplicate_journals_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertEqual(view.snapshot(root, root)["run"]["status"], "unavailable")
            events = self.fixture(root)
            events.insert(2, events[1])
            (root / "journal.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events))
            self.assertEqual(view.snapshot(root, root)["run"]["status"], "unavailable")
            (root / "journal.jsonl").write_text('{not json}\n')
            self.assertEqual(view.snapshot(root, root)["events"], [])

    def test_stale_score_and_label_identity_do_not_show_comparison(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.fixture(root)
            score = json.loads((root / "score.json").read_text()); score["rubricHash"] = "other"
            (root / "score.json").write_text(json.dumps(score))
            result = view.snapshot(root, root)
            self.assertFalse(result["score"]["available"])
            self.assertEqual(result["run"]["status"], "complete")
            self.fixture(root)
            label = json.loads((root / "pilot-expected.jsonl").read_text()); label["inputHash"] = "other"
            (root / "pilot-expected.jsonl").write_text(json.dumps(label) + "\n")
            self.assertFalse(view.snapshot(root, root)["score"]["available"])

    def test_invalid_terminal_record_never_reads_or_exposes_labels(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); events = self.fixture(root)
            events[-1].update(status="error", reason="failed")
            (root / "journal.jsonl").write_text("".join(json.dumps(event) + "\n" for event in events))
            with patch.object(view, "expected_label_rows", side_effect=AssertionError("labels must not be read")):
                result = view.snapshot(root, root)
            self.assertEqual(result["run"]["status"], "unavailable")
            self.assertEqual(result["records"], [])

    def test_duplicate_labels_empty_header_and_completed_tail_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.fixture(root)
            label = (root / "pilot-expected.jsonl").read_text()
            (root / "pilot-expected.jsonl").write_text(label + label)
            self.write_checksums(root)
            self.assertFalse(view.snapshot(root, root)["score"]["available"])

            self.fixture(root)
            events = [json.loads(line) for line in (root / "journal.jsonl").read_text().splitlines()]
            events[0]["runId"] = ""
            (root / "journal.jsonl").write_text("".join(json.dumps(event) + "\n" for event in events))
            self.assertEqual(view.snapshot(root, root)["run"]["status"], "unavailable")

            self.fixture(root)
            with (root / "journal.jsonl").open("a") as file: file.write('{"event":')
            self.assertEqual(view.snapshot(root, root)["run"]["status"], "unavailable")

    def test_executable_package_validation_skips_unrelated_inventory_and_binds_header_inputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.fixture(root)
            sentinel = root / "unrelated-sentinel.json"; sentinel.write_text("must not be read")
            self.write_checksums(root)
            original_read_bytes = Path.read_bytes
            def guarded_read_bytes(path, *args, **kwargs):
                if path == sentinel: raise AssertionError("unrelated inventory file was read")
                return original_read_bytes(path, *args, **kwargs)
            with patch.object(Path, "read_bytes", guarded_read_bytes):
                self.assertTrue(view.snapshot(root, root)["score"]["available"])

            events = self.fixture(root)
            for event in events:
                if "inputHash" in event: event["inputHash"] = "other-input"
            events[0]["inputs"][0]["inputHash"] = "other-input"
            (root / "journal.jsonl").write_text("".join(json.dumps(event) + "\n" for event in events))
            self.assertFalse(view.snapshot(root, root)["score"]["available"])

    def test_loopback_api_restricts_host_origin_path_and_methods(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); self.fixture(root)
            server = view.ThreadingHTTPServer(("127.0.0.1", 0), view.handler_for(root, root))
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            host = f"127.0.0.1:{server.server_port}"

            def request(method, path, headers):
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
                connection.request(method, path, headers=headers)
                response = connection.getresponse(); body = response.read(); status = response.status
                connection.close()
                return status, body

            try:
                status, body = request("GET", "/api/state", {"Host": host, "Origin": f"http://{host}"})
                self.assertEqual(status, 200); self.assertIn(b'"schemaVersion": "gtm-run-view-v1"', body)
                self.assertEqual(request("GET", "/api/state", {"Host": host, "Origin": "https://example.test"})[0], 403)
                self.assertEqual(request("GET", "/api/state", {"Host": "example.test", "Origin": "http://example.test"})[0], 403)
                self.assertEqual(request("GET", "/%2e%2e/scripts/gtm_run_view.py", {"Host": host})[0], 404)
                self.assertEqual(request("GET", "/api/state?unexpected=1", {"Host": host})[0], 404)
                self.assertEqual(request("POST", "/api/state", {"Host": host})[0], 501)
            finally:
                server.shutdown(); server.server_close(); thread.join(timeout=2)


if __name__ == "__main__": unittest.main()
