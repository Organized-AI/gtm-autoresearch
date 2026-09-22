import hashlib
import http.client
import io
import json
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path

from scripts.gtm_run_view import ThreadingHTTPServer, handler_for
from scripts.gtm_synthetic_view import load_bundle, synthetic_snapshot


class SyntheticViewTest(unittest.TestCase):
    def bundle(self, root, entries=("observations.jsonl",)):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
            for name in entries:
                output.writestr(name, '{"synthetic":true}\n')
        dataset = archive.getvalue()
        summary = {
            "schemaVersion": "gtm-synthetic-download-v1", "datasetSchema": "gtm-synthetic-v1",
            "trainOnly": True, "synthetic": True, "caseCount": 12, "sessionsPerCase": 4,
            "journeyFamilies": ["retail", "lead-generation"], "observedDate": "2026-09-22",
            "archive": {"sha256": hashlib.sha256(dataset).hexdigest(), "bytes": len(dataset)},
            "notices": ["Synthetic training data only."],
        }
        (root / "dataset.zip").write_bytes(dataset)
        (root / "summary.json").write_text(json.dumps(summary))
        return summary, dataset

    def test_valid_bundle_returns_summary_and_exact_archive_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); summary, dataset = self.bundle(root)
            snapshot, files = load_bundle(root)
            self.assertTrue(snapshot["available"])
            self.assertEqual(snapshot["summary"], summary)
            self.assertEqual(files["dataset.zip"], dataset)

    def test_tampered_or_truth_bearing_bundle_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); _summary, dataset = self.bundle(root)
            (root / "dataset.zip").write_bytes(dataset + b"tampered")
            self.assertFalse(synthetic_snapshot(root)[0]["available"])
            self.bundle(root, entries=("ground-truth.json",))
            self.assertFalse(synthetic_snapshot(root)[0]["available"])
            (root / "extra.json").write_text("{}")
            self.assertFalse(synthetic_snapshot(root)[0]["available"])

    def test_fixed_download_routes_revalidate_bundle_and_reject_other_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); summary, dataset = self.bundle(root)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(root, root, synthetic_bundle=root))
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()

            def request(path, origin=None):
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
                headers = {"Host": f"127.0.0.1:{server.server_port}"}
                if origin: headers["Origin"] = origin
                connection.request("GET", path, headers=headers)
                response = connection.getresponse()
                result = response.status, response.read(), response.getheader("Content-Disposition"), response.getheader("Content-Type")
                connection.close()
                return result

            try:
                status, body, _disposition, content_type = request("/api/synthetic")
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(body)["summary"], summary)
                status, body, disposition, content_type = request("/synthetic/dataset.zip")
                self.assertEqual(status, 200); self.assertEqual(body, dataset)
                self.assertIn("attachment;", disposition); self.assertTrue(content_type.startswith("application/zip"))
                self.assertEqual(json.loads(request("/synthetic/summary.json")[1]), summary)
                self.assertEqual(request("/synthetic/dataset.zip?other=1")[0], 404)
                self.assertEqual(request("/synthetic/truth.json")[0], 404)
                self.assertEqual(request("/synthetic/dataset.zip", "https://untrusted.example")[0], 403)
                (root / "dataset.zip").write_bytes(dataset + b"tampered")
                self.assertFalse(json.loads(request("/api/synthetic")[1])["available"])
                self.assertEqual(request("/synthetic/dataset.zip")[0], 404)
            finally:
                server.shutdown(); server.server_close(); thread.join(timeout=2)


if __name__ == "__main__": unittest.main()
