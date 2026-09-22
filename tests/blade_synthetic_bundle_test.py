import hashlib
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from scripts.prepare_blade_synthetic import prepare
from scripts.gtm_synthetic_view import load_bundle

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('blade_generator', ROOT / 'scripts/synthetic-lab/generate_blade_journeys.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


class BundleTest(unittest.TestCase):
    def test_real_package_excludes_oracle_and_binds_public_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data, bundle = root / 'data', root / 'bundle'
            generator.generate(ROOT / 'DOCUMENTATION/blade-synthetic/site-observations.json', data)
            summary = prepare(data, bundle)
            self.assertTrue(load_bundle(bundle)[0]['available'])
            self.assertEqual(summary['caseCount'], 13)
            with zipfile.ZipFile(bundle / 'dataset.zip') as archive:
                self.assertFalse(any('truth' in name for name in archive.namelist()))
                inventory = json.loads(archive.read('checksums.json'))
                self.assertEqual(set(archive.namelist()), set(inventory) | {'checksums.json'})
                for name, expected in inventory.items():
                    self.assertEqual(hashlib.sha256(archive.read(name)).hexdigest(), expected)
            with self.assertRaises(ValueError):
                prepare(data, bundle)
            case = json.loads((data / 'manifest.json').read_text())['cases'][0]
            (data / case['observation'] / 'meta-ads.json').write_text('{}')
            with self.assertRaises(ValueError):
                prepare(data, root / 'bad')


if __name__ == '__main__':
    unittest.main()
