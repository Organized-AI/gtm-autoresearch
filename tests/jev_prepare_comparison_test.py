import json
import sys
import tempfile
import unittest
from pathlib import Path

import jev_pilot_execute_test as execution_tests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import jev_prepare_comparison as prepare


class ComparisonPreparationTest(unittest.TestCase):
    def fixture(self, root):
        source = root / "source"; source.mkdir()
        execution_tests.ExecutePilotTest().make_package(source, count=2, expected=True)
        rubric = json.loads((source / "rubric.json").read_text())
        rubric["rubricVersion"] = "r2"
        rubric["functions"]["evidenceSufficient"]["description"] += " Explicitly withhold unsupported conclusions."
        path = root / "rubric-v2.json"; path.write_text(json.dumps(rubric))
        return source, path

    def test_comparison_preserves_input_bytes_answers_and_source_artifacts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source, rubric = self.fixture(root)
            before = {p.name: p.read_bytes() for p in source.iterdir()}
            output = root / "comparison"
            report = prepare.prepare_comparison(source, rubric, output)
            self.assertEqual(report["providerCalls"], 0)
            self.assertEqual(before, {p.name: p.read_bytes() for p in source.iterdir()})
            for name in ("pilot-inputs.jsonl", "pilot-expected.jsonl"):
                old = prepare.jev_pilot.read_jsonl(source / name)
                new = prepare.jev_pilot.read_jsonl(output / name)
                for left, right in zip(old, new):
                    self.assertNotEqual(left.pop("rubricHash"), right.pop("rubricHash"))
                    self.assertEqual(left, right)
            with self.assertRaisesRegex(ValueError, "already exists"):
                prepare.prepare_comparison(source, rubric, output)

    def test_label_tamper_is_rejected_without_partial_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source, rubric = self.fixture(root)
            path = source / "pilot-expected.jsonl"
            path.write_text(path.read_text().replace('"pass"', '"fail"'))
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                prepare.prepare_comparison(source, rubric, root / "comparison")
            self.assertFalse((root / "comparison").exists())

    def test_invalid_revised_rubric_is_rejected_without_partial_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source, rubric = self.fixture(root)
            value = json.loads(rubric.read_text()); value["functions"].pop("trackingBehaviorPreserved")
            rubric.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError, "two functions"):
                prepare.prepare_comparison(source, rubric, root / "comparison")
            self.assertFalse((root / "comparison").exists())


if __name__ == "__main__": unittest.main()
