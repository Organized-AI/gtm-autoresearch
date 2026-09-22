import hashlib
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

from scripts.gtm_export_view import export_snapshot
from scripts.gtm_run_view import handler_for, ThreadingHTTPServer


class ExportViewTest(unittest.TestCase):
    def bundle(self, root, ready=True):
        raw = b'{"exportFormatVersion":2,"containerVersion":{"tag":[]}}\n'
        (root / 'container.json').write_bytes(raw)
        report = {
            'schemaVersion': 'gtm-scored-export-v1',
            'source': {'sha256': hashlib.sha256(raw).hexdigest()},
            'validation': {'status': 'passed' if ready else 'blocked', 'errors': [] if ready else ['Missing reference'], 'warnings': []},
            'readiness': {'status': 'ready-for-import-review' if ready else 'blocked', 'blockers': [] if ready else ['Missing reference']},
        }
        (root / 'report.json').write_text(json.dumps(report))
        manifest = {'schemaVersion': 'gtm-scored-export-v1', 'files': {
            name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in ('container.json', 'report.json')}}
        (root / 'manifest.json').write_text(json.dumps(manifest))
        return raw

    def test_missing_or_tampered_bundle_never_offers_download(self):
        self.assertFalse(export_snapshot(None)[0]['available'])
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            raw = self.bundle(root)
            self.assertTrue(export_snapshot(root)[0]['downloadReady'])
            (root / 'container.json').write_bytes(raw + b' ')
            self.assertFalse(export_snapshot(root)[0]['available'])
            self.bundle(root)
            (root / 'report.json').write_text('{}')
            self.assertFalse(export_snapshot(root)[0]['available'])

    def test_download_bytes_are_verified_and_routes_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); raw = self.bundle(root)
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(root, root, export_bundle=root))
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            def request(route, origin=None):
                connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=2)
                connection.request('GET', route, headers={'Origin': origin} if origin else {})
                response = connection.getresponse()
                result = response.status, response.read(), response.getheader('Content-Disposition')
                connection.close()
                return result
            try:
                status, body, disposition = request('/exports/container.json')
                self.assertEqual(status, 200); self.assertEqual(body, raw)
                self.assertIn('attachment;', disposition)
                self.assertEqual(request('/exports/container.json', 'https://untrusted.example')[0], 403)
                self.assertEqual(request('/exports/../report.json')[0], 404)
                self.assertEqual(request('/exports/container.json?path=other')[0], 404)
                self.bundle(root, ready=False)
                self.assertEqual(request('/exports/container.json')[0], 409)
                self.assertEqual(request('/exports/report.json')[0], 200)
                self.assertFalse(json.loads(request('/api/export')[1])['downloadReady'])
                (root / 'manifest.json').write_text('{}')
                self.assertEqual(request('/exports/report.json')[0], 404)
            finally:
                server.shutdown(); server.server_close(); thread.join(timeout=2)


if __name__ == '__main__': unittest.main()
