import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from generate_blade_journeys import generate, hour, SCENARIOS, CONTAINER_FAULTS


class BladeJourneys(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source.json'
        self.source.write_text(json.dumps({'schemaVersion': 'blade-public-site-observations-v1',
                                          'pages': [{'url': 'https://www.blade.com/', 'observed': ['fact']}],
                                          'modelingAssumptions': ['modeled']}))
        self.out = self.root / 'out'
        self.manifest = generate(self.source, self.out, '20260923')
        self.truth = {self.read(p)['scenario']: self.read(p) for p in (self.out / 'truth').glob('????????????????.json')}

    def read(self, path):
        return json.loads(path.read_text())

    def case(self, scenario):
        return self.out / 'observations' / self.truth[scenario]['case_id']

    def rows(self, scenario, filename):
        return [json.loads(line) for line in (self.case(scenario) / filename).read_text().splitlines()]

    def conversions(self, scenario, platform, cutoff=60, window=1):
        report = self.read(self.case(scenario) / (platform + '-ads.json'))
        return next(s for s in report['snapshots'] if s['cutoff_hour'] == cutoff)['windows'][window]['conversions']

    def test_determinism_seed_changes_mix_and_all_hashes_bind_bytes(self):
        second = self.root / 'second'
        generate(self.source, second, '20260923')
        for path in self.out.rglob('*'):
            if path.is_file():
                self.assertEqual(path.read_bytes(), (second / path.relative_to(self.out)).read_bytes())
        for name, expected in self.read(self.out / 'checksums.json').items():
            self.assertEqual(hashlib.sha256((self.out / name).read_bytes()).hexdigest(), expected)
        changed = generate(self.source, self.root / 'other', 'other')
        new_rows = [json.loads(line) for line in (self.root / 'other' / changed['cases'][0]['observation'] / 'sessions.jsonl').read_text().splitlines()]
        self.assertNotEqual([(s['family'], s['consent'], s['source']) for s in new_rows],
                            [(s['family'], s['consent'], s['source']) for s in self.rows('healthy', 'sessions.jsonl')])
        with self.assertRaises(ValueError):
            generate(self.source, self.out)
        self.source.write_text('{}')
        with self.assertRaises(ValueError):
            generate(self.source, self.root / 'invalid')

    def test_all_pairs_exact_before_drift_and_all_192_sessions_retained(self):
        for scenario in SCENARIOS:
            self.assertEqual(self.rows('healthy', 'sessions.jsonl'), self.rows(scenario, 'sessions.jsonl'))
            self.assertEqual(len(self.rows(scenario, 'sessions.jsonl')), 192)
            for filename in ('site-events.jsonl', 'network-deliveries.jsonl'):
                before = lambda name: [r for r in self.rows(name, filename) if hour(r['occurred_at']) < 24]
                self.assertEqual(before('healthy'), before(scenario))
            for platform in ('meta', 'google'):
                self.assertEqual(self.conversions('healthy', platform, window=0), self.conversions(scenario, platform, window=0))

    def test_container_scope_is_interpreted_and_truth_excluded_from_observations(self):
        for scenario in SCENARIOS:
            path = self.case(scenario)
            before, after = [self.read(path / ('modeled-gtm-' + suffix + '.json')) for suffix in ('before', 'after')]
            self.assertEqual(before['exportFormatVersion'], 2)
            self.assertEqual(before != after, scenario in CONTAINER_FAULTS or scenario == 'benign_rename')
            self.assertEqual(self.truth[scenario]['container_defect'], scenario in CONTAINER_FAULTS)
            for file in path.iterdir():
                self.assertNotIn('"scenario"', file.read_text())
                self.assertNotIn('"container_defect"', file.read_text())
                self.assertNotIn('outcome_draw', file.read_text())
        for filename in ('site-events.jsonl', 'network-deliveries.jsonl', 'meta-ads.json', 'google-ads.json'):
            self.assertEqual((self.case('healthy') / filename).read_bytes(), (self.case('benign_rename') / filename).read_bytes())

    def test_reports_attribution_dedup_and_as_of_are_recomputed_from_rows(self):
        for scenario in SCENARIOS:
            sessions = {s['session_id']: s for s in self.rows(scenario, 'sessions.jsonl')}
            network = self.rows(scenario, 'network-deliveries.jsonl')
            event_ids = {e['event_id'] for e in self.rows(scenario, 'site-events.jsonl')}
            for row in network:
                original = row['event_id'].removesuffix('-server').removesuffix('-copy')
                self.assertIn(original, event_ids)
                self.assertEqual(row['consent'], sessions[row['session_id']]['consent'])
                if scenario != 'consent_bypass':
                    self.assertEqual(row['consent'], 'granted')
            for platform in ('meta', 'google'):
                report = self.read(self.case(scenario) / (platform + '-ads.json'))
                for snapshot in report['snapshots']:
                    cutoff = snapshot['cutoff_hour']
                    for window in snapshot['windows']:
                        visible = [r for r in network if r['destination'] == platform and r['source'] == platform
                                   and r['consent'] == 'granted' and hour(r['available_at']) <= cutoff
                                   and window['start_hour'] <= hour(r['occurred_at']) < min(cutoff, window['end_hour'])
                                   and (platform != 'google' or r['google_label'] == 'syn-label-' + r['event'])]
                        keys = {(r['event'], r['event_id']): r for r in visible}
                        self.assertEqual(window['conversions'], len(keys))
                        self.assertEqual(window['conversion_value'], sum(r['value'] for r in keys.values()))
                        self.assertEqual(window['conversions'], sum(a['conversions'] for a in window['actions']))
                        self.assertEqual(window['spend'], window['clicks'] * 1.25)

    def test_fault_effects_and_lag_recovery(self):
        for platform in ('meta', 'google'):
            healthy = self.conversions('healthy', platform)
            self.assertGreater(healthy, 0)
            self.assertGreater(self.conversions('duplicate_purchase', platform), healthy)
            self.assertLess(self.conversions('missing_booking_event', platform), healthy)
            self.assertEqual(self.conversions('cross_domain_attribution_loss', platform), 0)
            self.assertEqual(self.conversions('reporting_delay', platform), healthy)
            self.assertEqual(self.conversions('reporting_delay', platform, cutoff=30), 0)
            self.assertGreater(self.conversions('healthy', platform, cutoff=30), 0)
            self.assertEqual(self.conversions('consent_bypass', platform), healthy)
        self.assertEqual(self.conversions('wrong_google_label', 'google'), 0)
        self.assertEqual(self.conversions('wrong_google_label', 'meta'), self.conversions('healthy', 'meta'))
        self.assertGreater(self.conversions('mismatched_meta_event_id', 'meta'), self.conversions('healthy', 'meta'))
        self.assertEqual(self.conversions('mismatched_meta_event_id', 'google'), self.conversions('healthy', 'google'))
        denied = [r for r in self.rows('consent_bypass', 'network-deliveries.jsonl') if r['consent'] == 'denied']
        self.assertTrue(denied)
        self.assertTrue(all(hour(r['occurred_at']) >= 24 for r in denied))
        self.assertFalse(any(r['side'] == 'server' and hour(r['occurred_at']) >= 24 for r in self.rows('server_outage', 'network-deliveries.jsonl')))

    def test_business_controls_change_outcomes_without_truncating_time(self):
        healthy = self.rows('healthy', 'site-events.jsonl')
        for scenario in ('business_demand_drop', 'service_availability_reduction'):
            events = self.rows(scenario, 'site-events.jsonl')
            self.assertLess(len(events), len(healthy))
            self.assertEqual({e['session_id'] for e in events}, {e['session_id'] for e in healthy})
            self.assertGreater(max(hour(e['occurred_at']) for e in events), 47)
            self.assertFalse(self.truth[scenario]['tracking_fault'])
        non_airport = {s['session_id'] for s in self.rows('healthy', 'sessions.jsonl') if s['family'] != 'airport_booking'}
        self.assertEqual([e for e in healthy if e['session_id'] in non_airport],
                         [e for e in self.rows('service_availability_reduction', 'site-events.jsonl') if e['session_id'] in non_airport])


if __name__ == '__main__':
    unittest.main()
