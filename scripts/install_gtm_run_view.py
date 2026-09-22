#!/usr/bin/env python3
"""Install a verified recorded-run viewer as a per-user macOS LaunchAgent."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import time

import gtm_run_view as viewer
from gtm_export_view import load_bundle, FILES as EXPORT_FILES
from gtm_synthetic_view import load_bundle as load_synthetic_bundle, FILES as SYNTHETIC_FILES

LABEL = 'com.organizedai.gtm-run-view'
ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-dir', type=Path, required=True)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--baseline-run-dir', type=Path, required=True)
    parser.add_argument('--baseline-package', type=Path, required=True)
    parser.add_argument('--allow-origin', action='append', default=[], type=viewer.parse_allowed_origin)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--export-bundle', type=Path, help='Scored container bundle; retain installed bundle if omitted')
    parser.add_argument('--synthetic-bundle', type=Path, help='Synthetic-data bundle; retain installed bundle if omitted')
    args = parser.parse_args()
    if sys.platform != 'darwin': parser.error('This installer requires macOS.')
    sources = [(args.run_dir, args.package), (args.baseline_run_dir, args.baseline_package)]
    snapshots = [viewer.snapshot(run, package, include_comparison_identity=True) for run, package in sources]
    if not viewer.compare_completed_snapshots(*snapshots)['available']:
        parser.error('Installation requires a complete, verified comparison; active runs are not copied.')
    home = Path.home()
    service_root = home / 'Library/Application Support/GTM Autoresearch'
    export_source = args.export_bundle
    if export_source is None and (service_root / 'current/export').is_dir():
        export_source = service_root / 'current/export'
    export_files = load_bundle(export_source)[1] if export_source else None
    synthetic_source = args.synthetic_bundle
    if synthetic_source is None and (service_root / 'current/synthetic').is_dir():
        synthetic_source = service_root / 'current/synthetic'
    synthetic_files = load_synthetic_bundle(synthetic_source)[1] if synthetic_source else None
    releases = service_root / 'releases'
    releases.mkdir(parents=True, exist_ok=True)
    release = Path(tempfile.mkdtemp(prefix=datetime.datetime.now().strftime('%Y%m%d-%H%M%S-'), dir=releases))
    (release / 'scripts').mkdir()
    for name in ('gtm_run_view.py', 'gtm_export_view.py', 'gtm_synthetic_view.py', 'jev_pilot.py', 'jev_pilot_execute.py', 'jev_cloudflare_direct.py'):
        shutil.copy2(ROOT / 'scripts' / name, release / 'scripts' / name)
    shutil.copytree(ROOT / 'dashboard', release / 'dashboard')
    if export_files:
        (release / 'export').mkdir()
        for name in EXPORT_FILES:
            (release / 'export' / name).write_bytes(export_files[name])
        load_bundle(release / 'export')
    if synthetic_files:
        (release / 'synthetic').mkdir()
        for name in SYNTHETIC_FILES:
            (release / 'synthetic' / name).write_bytes(synthetic_files[name])
        load_synthetic_bundle(release / 'synthetic')
    for label, (run, package) in zip(('current-run', 'baseline'), sources):
        for folder, source, names in (
            ('run', run, ('journal.jsonl', 'results.jsonl', 'score.json')),
            ('package', package, ('checksums.json', 'rubric.json', 'pilot-inputs.jsonl', 'manifest.json', 'pilot-expected.jsonl')),
        ):
            target = release / label / folder
            target.mkdir(parents=True)
            for name in names: shutil.copy2(source / name, target / name)
    copied = [viewer.snapshot(release / label / 'run', release / label / 'package', include_comparison_identity=True) for label in ('current-run', 'baseline')]
    if not viewer.compare_completed_snapshots(*copied)['available']:
        raise RuntimeError('Copied artifacts failed verification; service was not changed.')
    manifest = {str(path.relative_to(release)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in release.rglob('*') if path.is_file()}
    (release / 'deployment.json').write_text(json.dumps({'sourceCheckout': str(ROOT), 'files': manifest}, indent=2) + '\n')
    # The stable link keeps launchd independent of the task session and /tmp.
    current = service_root / 'current'
    pending = service_root / ('current-' + release.name)
    pending.symlink_to(release, target_is_directory=True)
    os.replace(pending, current)
    logs = service_root / 'logs'; logs.mkdir(exist_ok=True)
    interpreter = next((str(alias) for alias in (Path('/opt/homebrew/bin/python3'), Path('/usr/local/bin/python3'))
                        if alias.exists() and os.path.samefile(alias, sys.executable)), sys.executable)
    program = [interpreter, '-u', str(current / 'scripts/gtm_run_view.py'),
               '--run-dir', str(current / 'current-run/run'), '--package', str(current / 'current-run/package'),
               '--baseline-run-dir', str(current / 'baseline/run'), '--baseline-package', str(current / 'baseline/package'),
               '--port', str(args.port)]
    for origin in args.allow_origin: program.extend(['--allow-origin', origin])
    if export_files: program.extend(['--export-bundle', str(current / 'export')])
    if synthetic_files: program.extend(['--synthetic-bundle', str(current / 'synthetic')])
    definition = {'Label': LABEL, 'ProgramArguments': program, 'WorkingDirectory': str(current),
                  'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 5,
                  'StandardOutPath': str(logs / 'stdout.log'), 'StandardErrorPath': str(logs / 'stderr.log')}
    agents = home / 'Library/LaunchAgents'; agents.mkdir(exist_ok=True)
    plist = agents / (LABEL + '.plist')
    plist.write_bytes(plistlib.dumps(definition))
    domain = f'gui/{os.getuid()}'
    loaded = subprocess.run(['launchctl', 'print', f'{domain}/{LABEL}'], capture_output=True).returncode == 0
    if loaded: subprocess.run(['launchctl', 'bootout', f'{domain}/{LABEL}'], check=True)
    # bootout can return before launchd has finished removing the old job.
    # Retry this one service briefly rather than leaving an update stopped.
    for attempt in range(6):
        started = subprocess.run(['launchctl', 'bootstrap', domain, str(plist)], capture_output=True, text=True)
        if started.returncode == 0:
            break
        if attempt == 5:
            raise RuntimeError(f'Could not start {LABEL}: {started.stderr.strip()}')
        time.sleep(0.5)
    print(json.dumps({'service': LABEL, 'release': str(release), 'plist': str(plist),
                      'port': args.port, 'providerCalls': 0}, indent=2))


if __name__ == '__main__': main()
