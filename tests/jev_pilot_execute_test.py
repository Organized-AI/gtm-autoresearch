import hashlib
import importlib.util
import json
import tempfile
import unittest
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("jev_pilot_execute", ROOT / "scripts/jev_pilot_execute.py")
assert SPEC and SPEC.loader
pilot = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = pilot
SPEC.loader.exec_module(pilot)


def canonical(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
def sha(value): return hashlib.sha256(value.encode("utf-8")).hexdigest()


class FakeFunction:
    def __init__(self, name, calls, failure=None): self.name, self.calls, self.failure = name, calls, failure
    def __call__(self, **kwargs):
        self.calls.append((self.name, kwargs))
        if self.failure: raise self.failure
        return type("Prediction", (), {"choice": "pass"})()
    def close(self): pass


class ExecutePilotTest(unittest.TestCase):
    def make_package(self, directory, count=1, expected=False):
        labels = {"pass": "p", "fail": "f", "insufficient": "i"}
        rubric = {"status": "seed", "rubricVersion": "r1", "preprocessingVersion": "synthetic-gtm-observation-v2", "functions": {name: {"description": name, "labels": labels} for name in pilot.FUNCTIONS}}
        rubric_hash = sha(canonical(rubric)); rows = []
        for index in range(count):
            observation = {"schemaVersion": "synthetic-gtm-observation-v2", "decisionTime": f"2026-01-{index + 1:02d}T00:00:00.000Z", "synthetic": True, "facts": {"index": index}, "cautions": []}
            value = {"observation": observation}; encoded = canonical(value)
            rows.append({"recordId": f"r{index}", "inputHash": sha(encoded), "canonicalInput": encoded, "input": value, "provenance": {"split": "train", "decisionTime": observation["decisionTime"]}, "deterministicReject": False, "rubricHash": rubric_hash})
        manifest = {"schemaVersion": "jev-pilot-package-v1", "rubricHash": rubric_hash, "pilotObservations": count, "maxAtomicEvaluations": count * 2}
        files = {"rubric.json": canonical(rubric) + "\n", "pilot-inputs.jsonl": "".join(json.dumps(row) + "\n" for row in rows), "manifest.json": json.dumps(manifest) + "\n"}
        if expected:
            expected_rows = [{"recordId": row["recordId"], "inputHash": row["inputHash"], "rubricHash": rubric_hash, "reviewStatus": "unreviewed", "provenance": "synthetic_generator_rule_not_human_reviewed", "labelVersion": "synthetic-observability-labels-v1", "deterministicReject": False, "expectedAnswers": {"evidenceSufficient": "pass", "trackingBehaviorPreserved": "pass"}} for row in rows]
            files["pilot-expected.jsonl"] = "".join(json.dumps(row) + "\n" for row in expected_rows)
        for name, content in files.items(): (directory / name).write_text(content, encoding="utf-8")
        (directory / "checksums.json").write_text(json.dumps({name: sha(content) for name, content in files.items()}), encoding="utf-8")
        return rubric_hash, rows

    def make_seed(self, directory, rubric_hash, provider="cloudflare", model="approved-model"):
        functions = {}
        for name in pilot.FUNCTIONS:
            saved = directory / name; saved.mkdir()
            state = {"run_id": name, "source_sha256": rubric_hash, "selected_columns": ["observation"], "column_mode": "selected", "backend": {"provider": provider, "model": model, "options": {}}, "current_candidate": {"kind": "multiclass", "instructions": name, "criteria": {"pass": "p", "fail": "f", "insufficient": "i"}}}
            (saved / "state.json").write_text(json.dumps(state), encoding="utf-8")
            functions[name] = {"path": str(saved), "definitionHash": sha(canonical(pilot.native_definition(state))), "provider": provider, "model": model}
        payload = {"status": "seed", "rubricHash": rubric_hash, "requestedModel": model, "preprocessingVersion": "synthetic-gtm-observation-v2", "rubricVersion": "r1", "policyVersion": "tracking-shadow-policy-v1", "functions": functions}
        manifest = {**payload, "manifestHash": sha(canonical(payload))}
        seed = directory / "seed-manifest.json"; seed.write_text(json.dumps(manifest), encoding="utf-8")
        return seed

    def config(self, directory, provider="cloudflare", model="approved-model"):
        value = {"schemaVersion": pilot.CONFIG_SCHEMA, "mode": "shadow", "provider": provider, "model": model, "providerSpendControl": {"kind": "provider-enforced-hard-limit", "reference": "external-control-id"}}
        path = directory / "execution.json"; path.write_text(json.dumps(value), encoding="utf-8"); return path

    def prepared(self, directory, count=1, provider="cloudflare", expected=False):
        rubric_hash, rows = self.make_package(directory, count, expected)
        seed = self.make_seed(directory, rubric_hash, provider)
        return pilot.prepare(directory, seed), self.config(directory, provider), rows

    def test_preflight_is_offline_and_checks_saved_function_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); prepared, config, _ = self.prepared(root)
            self.assertEqual(prepared.provider, "cloudflare")
            self.assertEqual(pilot.validate_execution_config(config, prepared)["mode"], "shadow")
            # Changing persisted native identity fails before a loader or provider can run.
            state = json.loads((root / "evidenceSufficient/state.json").read_text()); state["selected_columns"] = ["labels"]
            (root / "evidenceSufficient/state.json").write_text(json.dumps(state))
            with self.assertRaisesRegex(ValueError, "select only observation"):
                pilot.prepare(root, root / "seed-manifest.json")

    def test_absent_config_credential_and_identity_reject_with_zero_calls(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); prepared, config, _ = self.prepared(root); calls = []
            loader = lambda _: {name: FakeFunction(name, calls) for name in pilot.FUNCTIONS}
            with self.assertRaisesRegex(ValueError, "unable to read"):
                pilot.validate_execution_config(root / "missing.json", prepared)
            with self.assertRaisesRegex(ValueError, "missing provider credentials"):
                pilot.execute(prepared, config=pilot.validate_execution_config(config, prepared), results_path=root / "results.jsonl", journal_path=root / "journal.jsonl", run_id="run", environment={}, loader=loader, provider_guard=lambda *_: None)
            self.assertEqual(calls, [])
            bad = json.loads(config.read_text()); bad["model"] = "other"; config.write_text(json.dumps(bad))
            with self.assertRaisesRegex(ValueError, "provider/model"):
                pilot.validate_execution_config(config, prepared)
            self.assertEqual(calls, [])

    def test_twelve_rows_are_bounded_to_twenty_four_atomic_attempts_and_observation_only(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); prepared, config, rows = self.prepared(root, 12); calls = []
            loader = lambda _: {name: FakeFunction(name, calls) for name in pilot.FUNCTIONS}
            report = pilot.execute(prepared, config=pilot.validate_execution_config(config, prepared), results_path=root / "results.jsonl", journal_path=root / "journal.jsonl", run_id="run", environment={"CLOUDFLARE_ACCOUNT_ID": "test", "CLOUDFLARE_API_TOKEN": "test"}, loader=loader, provider_guard=lambda *_: None)
            self.assertEqual(report["atomicAttempts"], 24); self.assertEqual(len(calls), 24)
            self.assertTrue(all(set(payload) == {"observation"} for _, payload in calls))
            self.assertEqual(len(pilot.existing_jsonl(root / "results.jsonl")), 12)
            self.assertFalse((root / "pilot-expected.jsonl").exists())

    def test_errors_consume_attempts_and_make_complete_error_records(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); prepared, config, _ = self.prepared(root, 2); calls = []
            loader = lambda _: {name: FakeFunction(name, calls, TimeoutError() if name == "evidenceSufficient" else None) for name in pilot.FUNCTIONS}
            report = pilot.execute(prepared, config=pilot.validate_execution_config(config, prepared), results_path=root / "results.jsonl", journal_path=root / "journal.jsonl", run_id="run", environment={"CLOUDFLARE_ACCOUNT_ID": "test", "CLOUDFLARE_API_TOKEN": "test"}, loader=loader, provider_guard=lambda *_: None)
            self.assertEqual(report["atomicAttempts"], 2); self.assertEqual([row["status"] for row in pilot.existing_jsonl(root / "results.jsonl")], ["error", "error"])
            self.assertEqual(len(calls), 2)

    def test_interruption_does_not_retry_started_atomic_attempt_on_resume(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); prepared, config, _ = self.prepared(root); calls = []
            loader = lambda _: {name: FakeFunction(name, calls, KeyboardInterrupt() if name == "evidenceSufficient" else None) for name in pilot.FUNCTIONS}
            kwargs = dict(config=pilot.validate_execution_config(config, prepared), results_path=root / "results.jsonl", journal_path=root / "journal.jsonl", run_id="run", environment={"CLOUDFLARE_ACCOUNT_ID": "test", "CLOUDFLARE_API_TOKEN": "test"}, loader=loader, provider_guard=lambda *_: None)
            with self.assertRaises(KeyboardInterrupt): pilot.execute(prepared, **kwargs)
            self.assertEqual(len(calls), 1)
            # Resume never invokes the partially started function again.
            pilot.execute(prepared, **kwargs)
            self.assertEqual(len(calls), 1)
            self.assertEqual(pilot.existing_jsonl(root / "results.jsonl")[0]["status"], "error")

    def test_unverified_spend_reference_cannot_enable_provider_calls(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); prepared, config, _ = self.prepared(root); calls = []
            with self.assertRaisesRegex(ValueError, "no verified provider"):
                pilot.execute(prepared, config=pilot.validate_execution_config(config, prepared), results_path=root / "results.jsonl", journal_path=root / "journal.jsonl", run_id="run", environment={"CLOUDFLARE_ACCOUNT_ID": "test", "CLOUDFLARE_API_TOKEN": "test"}, loader=lambda _: {name: FakeFunction(name, calls) for name in pilot.FUNCTIONS})
            self.assertEqual(calls, [])

    def test_timeout_consumes_started_attempt_and_journal_rebuilds_results(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); prepared, config, _ = self.prepared(root); calls = []
            class Slow(FakeFunction):
                def __call__(self, **kwargs):
                    self.calls.append((self.name, kwargs)); time.sleep(0.03)
            original = pilot.MAX_ATOMIC_SECONDS; pilot.MAX_ATOMIC_SECONDS = 0.005
            try:
                report = pilot.execute(prepared, config=pilot.validate_execution_config(config, prepared), results_path=root / "results.jsonl", journal_path=root / "journal.jsonl", run_id="run", environment={"CLOUDFLARE_ACCOUNT_ID": "test", "CLOUDFLARE_API_TOKEN": "test"}, loader=lambda _: {name: Slow(name, calls) if name == "evidenceSufficient" else FakeFunction(name, calls) for name in pilot.FUNCTIONS}, provider_guard=lambda *_: None)
            finally:
                pilot.MAX_ATOMIC_SECONDS = original
            self.assertEqual(report["atomicAttempts"], 1)
            self.assertIn("AtomicTimeout", pilot.existing_jsonl(root / "results.jsonl")[0]["reason"])
            (root / "results.jsonl").unlink()
            # Completed journal state is authoritative after a crash between journal and result publication.
            pilot.execute(prepared, config=pilot.validate_execution_config(config, prepared), results_path=root / "results.jsonl", journal_path=root / "journal.jsonl", run_id="run", environment={"CLOUDFLARE_ACCOUNT_ID": "test", "CLOUDFLARE_API_TOKEN": "test"}, loader=lambda _: {name: FakeFunction(name, calls) for name in pilot.FUNCTIONS}, provider_guard=lambda *_: None)
            self.assertEqual(len(pilot.existing_jsonl(root / "results.jsonl")), 1)
            self.assertEqual(len(calls), 1)

    def test_label_files_are_never_opened_and_journal_or_output_tampering_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); prepared, config, _ = self.prepared(root, expected=True)
            inventory = json.loads((root / "checksums.json").read_text()); inventory["train-expected.jsonl"] = "0" * 64
            (root / "checksums.json").write_text(json.dumps(inventory)); (root / "pilot-expected.jsonl").unlink()
            # Expected-label inventory entries can be absent: no label bytes are read by prepare.
            prepared = pilot.prepare(root, root / "seed-manifest.json")
            results, journal = root / "results.jsonl", root / "journal.jsonl"; results.write_text("unrelated output")
            with self.assertRaisesRegex(ValueError, "existing results"):
                pilot.execute(prepared, config=pilot.validate_execution_config(config, prepared), results_path=results, journal_path=journal, run_id="run", environment={"CLOUDFLARE_ACCOUNT_ID": "test", "CLOUDFLARE_API_TOKEN": "test"}, loader=lambda _: {name: FakeFunction(name, []) for name in pilot.FUNCTIONS}, provider_guard=lambda *_: None)
            results.unlink()
            pilot.execute(prepared, config=pilot.validate_execution_config(config, prepared), results_path=results, journal_path=journal, run_id="run", environment={"CLOUDFLARE_ACCOUNT_ID": "test", "CLOUDFLARE_API_TOKEN": "test"}, loader=lambda _: {name: FakeFunction(name, []) for name in pilot.FUNCTIONS}, provider_guard=lambda *_: None)
            lines = journal.read_text().splitlines(); header = json.loads(lines[0]); header["inputs"][0]["inputHash"] = "0" * 64; lines[0] = json.dumps(header); journal.write_text("\n".join(lines) + "\n")
            with self.assertRaisesRegex(ValueError, "immutable run header"):
                pilot.execute(prepared, config=pilot.validate_execution_config(config, prepared), results_path=results, journal_path=journal, run_id="run", environment={"CLOUDFLARE_ACCOUNT_ID": "test", "CLOUDFLARE_API_TOKEN": "test"}, loader=lambda _: {name: FakeFunction(name, []) for name in pilot.FUNCTIONS}, provider_guard=lambda *_: None)

    def test_typesafe_retries_are_rejected_and_output_scores_offline(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); prepared, config, _ = self.prepared(root, provider="typesafe", expected=True); calls = []
            with self.assertRaisesRegex(ValueError, "hidden SDK retries"):
                pilot.execute(prepared, config=pilot.validate_execution_config(config, prepared), results_path=root / "results.jsonl", journal_path=root / "journal.jsonl", run_id="run", environment={"TYPESAFE_API_KEY": "test"}, loader=lambda _: {name: FakeFunction(name, calls) for name in pilot.FUNCTIONS}, provider_guard=lambda *_: None)
            self.assertEqual(calls, [])
            # A Cloudflare fake run creates artifacts accepted by the existing scorer.
            cloud = root / "cloud"; cloud.mkdir()
            prepared, config, _ = self.prepared(cloud, expected=True)
            calls = []
            pilot.execute(prepared, config=pilot.validate_execution_config(config, prepared), results_path=prepared.package / "results.jsonl", journal_path=prepared.package / "journal.jsonl", run_id="run", environment={"CLOUDFLARE_ACCOUNT_ID": "test", "CLOUDFLARE_API_TOKEN": "test"}, loader=lambda _: {name: FakeFunction(name, calls) for name in pilot.FUNCTIONS}, provider_guard=lambda *_: None)
            score = pilot.jev_pilot.score(prepared.package, prepared.package / "results.jsonl")
            self.assertEqual(score["predictionCount"], 1)


if __name__ == "__main__": unittest.main()
