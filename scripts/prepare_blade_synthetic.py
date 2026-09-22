#!/usr/bin/env python3
"""Build a verified observation-only download; never packages oracle files."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CASE_FILES = {'sessions.jsonl', 'site-events.jsonl', 'network-deliveries.jsonl',
              'meta-ads.json', 'google-ads.json', 'modeled-gtm-before.json',
              'modeled-gtm-after.json', 'context.json'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def prepare(dataset, output):
    dataset, output = Path(dataset), Path(output)
    if output.exists():
        raise ValueError('refusing existing output')
    checksums = json.loads((dataset / 'checksums.json').read_text())
    def checked(name):
        path = dataset / name
        if path.is_symlink() or not path.resolve().is_relative_to(dataset.resolve()):
            raise ValueError('invalid dataset path')
        data = path.read_bytes()
        if sha(data) != checksums.get(name):
            raise ValueError('dataset checksum mismatch: ' + name)
        return data
    files = {'manifest.json': checked('manifest.json'), 'site-observations.json': checked('site-observations.json')}
    manifest = json.loads(files['manifest.json'])
    facts = json.loads(files['site-observations.json'])
    if (manifest.get('schemaVersion') != 'blade-journey-synthetic-v1' or manifest.get('split') != 'train-only'
            or manifest.get('synthetic') is not True or manifest['siteObservationsSha256'] != sha(files['site-observations.json'])):
        raise ValueError('invalid training manifest')
    for case in manifest['cases']:
        case_id = case['case_id']
        if len(case_id) != 16 or any(c not in '0123456789abcdef' for c in case_id) or case['observation'] != 'observations/' + case_id or set(case['files']) != CASE_FILES:
            raise ValueError('invalid case inventory')
        for name, expected in case['files'].items():
            relative = case['observation'] + '/' + name
            data = checked(relative)
            if sha(data) != expected:
                raise ValueError('case checksum mismatch')
            files[relative] = data
    files['README.md'] = (ROOT / 'DOCUMENTATION/blade-synthetic/README.md').read_bytes()
    files['checksums.json'] = (json.dumps({name: sha(data) for name, data in sorted(files.items())}, indent=2) + '\n').encode()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 9, 22, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    zipped = buffer.getvalue()
    if len(zipped) > 8_000_000:
        raise ValueError('archive exceeds viewer limit')
    summary = {'schemaVersion': 'gtm-synthetic-download-v1', 'datasetSchema': manifest['schemaVersion'],
               'trainOnly': True, 'synthetic': True, 'caseCount': len(manifest['cases']),
               'sessionsPerCase': manifest['sessionsPerCase'], 'journeyFamilies': manifest['journeyFamilies'],
               'observedDate': facts['observedDate'], 'archive': {'sha256': sha(zipped), 'bytes': len(zipped)},
               'notices': ['Fictional events and ad data informed by public BLADE pages; no real visitor records.',
                           '13 paired cases, 48 hours, change boundary at hour 24; reports at hours 24, 30 and 60.',
                           'Oracle labels excluded. Training only; not the frozen Jev pilot or reserved evaluation data.',
                           'Modeled GTM files are simulation fixtures, not importable containers. Use Container export for the scored GTM JSON.',
                           'Prepared evidence only; daily behavioral evaluation and Jev inference are not connected.']}
    output.mkdir(parents=True)
    (output / 'dataset.zip').write_bytes(zipped)
    (output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.dataset, args.output), indent=2))
