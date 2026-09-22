#!/usr/bin/env python3
"""Seeded, network-free BLADE-informed training data; never runs a real container."""
import argparse
import copy
import hashlib
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCENARIOS = ('healthy', 'benign_rename', 'missing_booking_event', 'renamed_site_event',
             'duplicate_purchase', 'mismatched_meta_event_id', 'wrong_google_label',
             'consent_bypass', 'cross_domain_attribution_loss', 'reporting_delay',
             'business_demand_drop', 'service_availability_reduction', 'server_outage')
FLOWS = {
    'airport_booking': ['page_view', 'view_service', 'flight_search', 'select_flight', 'begin_checkout', 'purchase'],
    'charter_inquiry': ['page_view', 'view_service', 'form_start', 'generate_lead'],
    'signup': ['page_view', 'form_start', 'sign_up'],
    'app_handoff': ['page_view', 'app_outbound_click'],
}
ACTIONS = {family: flow[-1] for family, flow in FLOWS.items()}
VALUES = {'purchase': 240, 'generate_lead': 50, 'sign_up': 0, 'app_outbound_click': 0}
START = datetime(2026, 9, 20, tzinfo=timezone.utc)
CONTAINER_FAULTS = {'missing_booking_event', 'duplicate_purchase', 'mismatched_meta_event_id',
                    'wrong_google_label', 'consent_bypass', 'cross_domain_attribution_loss'}


def digest(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, sort_keys=True, indent=2) + '\n')


def write_rows(path, rows):
    path.write_text(''.join(json.dumps(row, sort_keys=True) + '\n' for row in rows))


def stamp(hour):
    return (START + timedelta(hours=hour)).isoformat()


def hour(timestamp):
    return (datetime.fromisoformat(timestamp) - START).total_seconds() / 3600


def sessions(seed):
    rng = random.Random(seed)
    rows = []
    for i in range(192):
        family = rng.choice(list(FLOWS))
        rows.append({'session_id': 's-' + digest(f'{seed}:{i}')[:16],
                     'visitor_id': 'v-' + digest(f'{seed}:visitor:{i}')[:16],
                     'started_at': stamp(i // 4 + (i % 4) / 6), 'family': family,
                     'source': rng.choice(['meta', 'google', 'organic', 'referral']),
                     'device': rng.choice(['mobile', 'desktop']),
                     'consent': 'granted' if rng.random() > .22 else 'denied',
                     'stage_count': len(FLOWS[family]) if rng.random() < .65 else rng.randrange(1, len(FLOWS[family])),
                     'outcome_draw': rng.random(),
                     'landing_url': 'https://blade.synthetic.invalid/' + family})
    return rows


def site_events(source, scenario):
    rows = []
    for session in source:
        flow = FLOWS[session['family']]
        count = session['stage_count']
        post = hour(session['started_at']) >= 24
        reduced = post and (scenario == 'business_demand_drop' or
                           scenario == 'service_availability_reduction' and session['family'] == 'airport_booking')
        if reduced and session['outcome_draw'] < .8:
            count = min(count, len(flow) - 1)
        for index, name in enumerate(flow[:count]):
            if post and scenario == 'renamed_site_event' and name == 'purchase':
                name = 'booking_complete_v2'
            rows.append({'session_id': session['session_id'], 'event': name,
                         'event_id': 'e-' + digest(session['session_id'] + ':' + str(index))[:18],
                         'occurred_at': stamp(hour(session['started_at']) + index / 60),
                         'value': VALUES.get(name, 0), 'currency': 'USD', 'synthetic': True})
    return rows


def container():
    tags = []
    for index, (destination, side) in enumerate([('meta', 'browser'), ('meta', 'server'), ('google', 'browser')], 1):
        config = {'destination': destination, 'side': side, 'events': list(VALUES), 'copies': 1,
                  'idMode': 'shared', 'labelPrefix': 'syn-label-', 'requireConsent': True, 'retainSource': True}
        tags.append({'tagId': str(index), 'name': destination + ' ' + side, 'type': 'synthetic_model',
                     'firingTriggerId': ['1'], 'parameter': [{'type': 'TEMPLATE', 'key': 'modelConfig', 'value': json.dumps(config, sort_keys=True)}]})
    return {'exportFormatVersion': 2, 'containerVersion': {
        'container': {'name': 'Fictional BLADE journey model', 'publicId': 'GTM-SYNTHETIC', 'usageContext': ['WEB']},
        'tag': tags, 'trigger': [{'triggerId': '1', 'name': 'Modeled conversion events', 'type': 'CUSTOM_EVENT'}],
        'variable': [{'variableId': '1', 'name': 'event_id', 'type': 'v', 'parameter': [{'type': 'TEMPLATE', 'key': 'name', 'value': 'event_id'}]}],
        'folder': []}}


def changed_container(before, scenario):
    after = copy.deepcopy(before)
    for tag in after['containerVersion']['tag']:
        config = json.loads(tag['parameter'][0]['value'])
        if scenario == 'benign_rename':
            tag['name'] = 'Organized / ' + tag['name']
        elif scenario == 'missing_booking_event':
            config['events'].remove('purchase')
        elif scenario == 'duplicate_purchase':
            config['copies'] = 2
        elif scenario == 'mismatched_meta_event_id' and config['side'] == 'server':
            config['idMode'] = 'separate'
        elif scenario == 'wrong_google_label' and config['destination'] == 'google':
            config['labelPrefix'] = 'syn-invalid-'
        elif scenario == 'consent_bypass':
            config['requireConsent'] = False
        elif scenario == 'cross_domain_attribution_loss':
            config['retainSource'] = False
        tag['parameter'][0]['value'] = json.dumps(config, sort_keys=True)
    return after


def deliveries(source, events, before, after, scenario):
    by_id = {s['session_id']: s for s in source}
    rows = []
    for event in events:
        session = by_id[event['session_id']]
        post = hour(event['occurred_at']) >= 24
        active = after if post else before
        for tag in active['containerVersion']['tag']:
            config = json.loads(tag['parameter'][0]['value'])
            if event['event'] not in config['events'] or config['requireConsent'] and session['consent'] != 'granted':
                continue
            if post and scenario == 'server_outage' and config['side'] == 'server':
                continue
            copies = config['copies'] if event['event'] == 'purchase' else 1
            for index in range(copies):
                event_id = event['event_id'] + ('-copy' if index else '')
                if config['idMode'] == 'separate':
                    event_id += '-server'
                rows.append({'delivery_id': 'd-' + digest(event_id + ':' + tag['tagId'])[:18],
                             'session_id': event['session_id'], 'event': event['event'], 'event_id': event_id,
                             'destination': config['destination'], 'side': config['side'],
                             'source': session['source'] if config['retainSource'] else 'direct',
                             'consent': session['consent'], 'occurred_at': event['occurred_at'],
                             'available_at': stamp(hour(event['occurred_at']) + (12 if post and scenario == 'reporting_delay' else 1)),
                             'conversion_action': 'syn-action-' + event['event'],
                             'google_label': config['labelPrefix'] + event['event'] if config['destination'] == 'google' else None,
                             'value': event['value'], 'currency': 'USD',
                             'collect_url': 'https://collect.synthetic.invalid/' + config['destination'], 'synthetic': True})
    return rows


def reports(source, network, platform):
    snapshots = []
    for cutoff in (24, 30, 60):
        windows = []
        for begin, end in ((0, 24), (24, 48)):
            unique = {}
            for row in network:
                if (row['destination'] != platform or row['source'] != platform or row['consent'] != 'granted'
                        or not begin <= hour(row['occurred_at']) < end or hour(row['occurred_at']) >= cutoff
                        or hour(row['available_at']) > cutoff):
                    continue
                if platform == 'google' and row['google_label'] != 'syn-label-' + row['event']:
                    continue
                unique[(row['event'], row['event_id'])] = row
            clicks = sum(s['source'] == platform and begin <= hour(s['started_at']) < min(end, cutoff) for s in source)
            windows.append({'start_hour': begin, 'end_hour': end, 'complete_event_window': cutoff >= end,
                            'campaign_id': 'syn-' + platform + '-campaign', 'clicks': clicks, 'impressions': clicks * 20,
                            'spend': round(clicks * 1.25, 2), 'currency': 'USD',
                            'conversions': len(unique), 'conversion_value': sum(x['value'] for x in unique.values()),
                            'actions': [{'id': 'syn-action-' + action, 'event': action,
                                         'conversions': sum(x['event'] == action for x in unique.values())} for action in VALUES]})
        snapshots.append({'as_of': stamp(cutoff), 'cutoff_hour': cutoff, 'windows': windows})
    return {'platform': platform, 'account_id': 'syn-' + platform + '-account', 'synthetic': True,
            'attribution': 'Same-session source match; granted consent; event-name plus event-id deduplication; Google requires expected label. No platform-estimated cookieless conversions.',
            'snapshots': snapshots}


def generate(observations, output, seed='20260923'):
    source_bytes = Path(observations).read_bytes()
    facts = json.loads(source_bytes)
    if facts.get('schemaVersion') != 'blade-public-site-observations-v1' or not isinstance(facts.get('pages'), list) or not facts['pages'] or not isinstance(facts.get('modelingAssumptions'), list):
        raise ValueError('invalid site observations')
    output = Path(output)
    if output.exists():
        raise ValueError('refusing existing output')
    output.mkdir(parents=True)
    (output / 'truth').mkdir()
    (output / 'site-observations.json').write_bytes(source_bytes)
    base = sessions(str(seed))
    manifest = {'schemaVersion': 'blade-journey-synthetic-v1', 'split': 'train-only', 'synthetic': True,
                'seed': str(seed), 'hours': 48, 'driftHour': 24, 'sessionsPerCase': len(base), 'journeyFamilies': list(FLOWS),
                'generatorSha256': digest(Path(__file__).read_bytes()), 'siteObservationsSha256': digest(source_bytes),
                'assumptions': facts['modelingAssumptions'] + [
                    '192 sessions over 48 hours; seeded 65% completion prior before controls; synthetic $240 booking and $50 lead value, zero signup/app-click value.',
                    'Meta and Google attribution uses same-session paid source only, no view-through or cross-device modeling; reports mature by hour 60.',
                    'Delivery/report latency is one hour, twelve hours for post-change delay case; consent bypass deliveries excluded from paid attribution.',
                    'GTM-shaped artifacts use fictional model types and are not importable containers; routing is interpreted by this Python simulator only.',
                    'Public raw rows cover the full experiment. Filter occurrence and availability timestamps before decision-time evaluation.'],
                'cases': []}
    for index, scenario in enumerate(SCENARIOS):
        case_id = digest(f'{seed}:case:{index}')[:16]
        folder = output / 'observations' / case_id
        folder.mkdir(parents=True)
        before = container()
        after = changed_container(before, scenario)
        events = site_events(base, scenario)
        network = deliveries(base, events, before, after, scenario)
        public_sessions = [{k: v for k, v in s.items() if k not in ('outcome_draw', 'stage_count')} for s in base]
        write_rows(folder / 'sessions.jsonl', public_sessions)
        write_rows(folder / 'site-events.jsonl', events)
        write_rows(folder / 'network-deliveries.jsonl', network)
        write_json(folder / 'modeled-gtm-before.json', before)
        write_json(folder / 'modeled-gtm-after.json', after)
        for platform in ('meta', 'google'):
            write_json(folder / (platform + '-ads.json'), reports(base, network, platform))
        write_json(folder / 'context.json', {'start': stamp(0), 'end': stamp(48), 'change_boundary': stamp(24),
                                           'container_after_effective_at': stamp(24), 'synthetic': True})
        manifest['cases'].append({'case_id': case_id, 'observation': str(folder.relative_to(output)),
                                  'files': {p.name: digest(p.read_bytes()) for p in sorted(folder.iterdir())}})
        write_json(output / 'truth' / (case_id + '.json'), {
            'case_id': case_id, 'scenario': scenario, 'injection_hour': 24, 'container_defect': scenario in CONTAINER_FAULTS,
            'tracking_fault': scenario in CONTAINER_FAULTS or scenario in ('renamed_site_event', 'server_outage'),
            'review_status': 'unreviewed-generator-truth', 'synthetic': True})
    write_json(output / 'manifest.json', manifest)
    write_json(output / 'truth' / 'checksums.json', {p.name: digest(p.read_bytes()) for p in sorted((output / 'truth').glob('*.json'))})
    write_json(output / 'checksums.json', {str(p.relative_to(output)): digest(p.read_bytes()) for p in sorted(output.rglob('*')) if p.is_file()})
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site-observations', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--seed', default='20260923')
    args = parser.parse_args()
    generate(args.site_observations, args.output, args.seed)
