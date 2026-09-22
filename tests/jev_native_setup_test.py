import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class NativeFreezeTest(unittest.TestCase):
    def test_creates_seed_only_functions_with_observation_input(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "seed"
            result = subprocess.run([sys.executable, str(ROOT / "scripts/jev_freeze.py"), "--rubric", str(ROOT / "DOCUMENTATION/jev-shadow-pilot/rubric-v1.json"), "--output", str(output), "--provider", "typesafe", "--model", "jev-test"], check=True, text=True, capture_output=True)
            manifest = json.loads(result.stdout)
            self.assertEqual(manifest["status"], "seed")
            self.assertEqual(manifest["requestedModel"], "jev-test")
            self.assertEqual(set(manifest["functions"]), {"evidenceSufficient", "trackingBehaviorPreserved"})
            for spec in manifest["functions"].values():
                state = json.loads((Path(spec["path"]) / "state.json").read_text())
                self.assertEqual(state["selected_columns"], ["observation"])
                self.assertEqual(state["history"][0]["decision"], "seed")
            failed = subprocess.run([sys.executable, str(ROOT / "scripts/jev_freeze.py"), "--rubric", str(ROOT / "DOCUMENTATION/jev-shadow-pilot/rubric-v1.json"), "--output", str(output), "--provider", "typesafe", "--model", "jev-test"], text=True, capture_output=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn("refusing to overwrite", failed.stderr)


if __name__ == "__main__":
    unittest.main()
