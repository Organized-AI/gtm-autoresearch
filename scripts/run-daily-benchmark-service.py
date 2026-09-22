#!/usr/bin/env python3
"""Run the offline BLADE benchmark and optionally refresh its private viewer."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', type=Path, required=True)
    parser.add_argument('--node', default='node')
    parser.add_argument('--evidence', type=Path)
    parser.add_argument('--publish-viewer', action='store_true', help='Update only the private local dashboard; never GTM')
    args = parser.parse_args()
    command = [args.node, '--import', 'tsx', str(ROOT / 'scripts/run-daily-benchmark.ts'),
               '--state-dir', str(args.state_dir.resolve())]
    if args.evidence:
        command.extend(['--evidence', str(args.evidence.resolve())])
    completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=True, timeout=120)
    result = json.loads(completed.stdout)
    if args.publish_viewer:
        if result.get('exportReadiness') != 'ready-for-import-review':
            raise RuntimeError('Benchmark export is not ready; the previous dashboard export is retained')
        # Resolve the installed release before the installer switches current.
        current = (Path.home() / 'Library/Application Support/GTM Autoresearch/current').resolve(strict=True)
        install = [sys.executable, str(ROOT / 'scripts/install_gtm_run_view.py'),
                   '--run-dir', str(current / 'current-run/run'), '--package', str(current / 'current-run/package'),
                   '--baseline-run-dir', str(current / 'baseline/run'), '--baseline-package', str(current / 'baseline/package'),
                   '--export-bundle', result['exportDir'], '--port', '8765',
                   '--allow-origin', 'http://jordans-mac-mini.tailb35295.ts.net:8765',
                   '--allow-origin', 'http://100.86.248.8:8765']
        subprocess.run(install, cwd=ROOT, check=True, capture_output=True, text=True, timeout=60)
    print(json.dumps({'outcome': result['outcome'], 'before': result['before'], 'after': result['after'],
                      'exportDir': result['exportDir'], 'viewerUpdated': args.publish_viewer,
                      'scope': result['limitations']}, indent=2))


if __name__ == '__main__':
    main()
