"""Offline GTM drift simulation. All identities, payloads and metrics are synthetic."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import random
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

VERSION = "1.0.0"
START = datetime(2026, 1, 1, tzinfo=timezone.utc)
DRIFT_HOUR = 24
HOURS = 48
EVENTS = ["page_view", "view_item", "add_to_cart", "begin_checkout", "purchase"]
SCENARIOS = [
    ("healthy", "none", "No injected fault; deduplication, consent and reporting work."),
    ("benign_rename", "benign_container_drift", "Only a tag name changes; delivery stays identical."),
    ("broken_trigger_reference", "structural_container_fault", "Purchase tag points to a nonexistent trigger."),
    ("purchase_trigger_mismatch", "semantic_container_fault", "Purchase trigger expects order_complete, but the site pushes purchase."),
    ("meta_event_id_mismatch", "semantic_container_fault", "Meta browser/server purchase IDs diverge; deduplication fails."),
    ("google_label_mismatch", "semantic_container_fault", "GAds purchase tag uses an unrecognized conversion label."),
    ("consent_bypass", "semantic_container_fault", "Meta browser tag sends purchases despite denied consent."),
    ("server_outage", "transport_fault", "Server deliveries fail with 503; both container versions are unchanged."),
    ("match_data_missing", "semantic_container_fault", "Server purchase tag omits matching fields; delivery counts stay intact."),
    ("business_conversion_drop", "business_change", "Visitor checkout completion falls; collection remains intact."),
    ("reporting_delay", "reporting_latency", "GAds reports arrive eight hours late; requests remain successful."),
    ("traffic_mix_shift", "traffic_change", "Paid traffic is replaced by organic visits; container and total funnel remain stable."),
]


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def iso(value):
    return value.isoformat().replace("+00:00", "Z")


def dt(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def param(key, value):
    return {"type": "TEMPLATE", "key": key, "value": value}


def set_param(entity, key, value):
    for item in entity.get("parameter", []):
        if item["key"] == key:
            item["value"] = value
            return
    entity.setdefault("parameter", []).append(param(key, value))


def get_param(entity, key):
    return next((p["value"] for p in entity.get("parameter", []) if p["key"] == key), None)


def make_container(server=False):
    cid = "9000003" if server else "9000002"
    common = {"accountId": "9000001", "containerId": cid}
    tags = []
    for idx, event in enumerate(EVENTS, 1):
        platforms = ["meta_server"] if server else ["ga4", "meta_browser", "google_ads"]
        for pidx, platform in enumerate(platforms, 1):
            if platform == "google_ads" and event != "purchase":
                continue
            tag = {
                **common, "tagId": str(idx * 10 + pidx), "name": f"{platform} - {event}",
                "type": "cvt_9000001_1" if platform.startswith("meta") else ("awct" if platform == "google_ads" else "gaawe"),
                "parameter": [param("eventName", event), param("event_id", "{{Event ID}}")],
                "firingTriggerId": [str(idx)], "tagFiringOption": "ONCE_PER_EVENT",
                "consentSettings": {"consentStatus": "NEEDED", "consentType": {"type": "LIST", "list": [{"type": "TEMPLATE", "value": "ad_storage" if platform != "ga4" else "analytics_storage"}]}},
                "parentFolderId": "1", "fingerprint": "synthetic-v1",
                "monitoringMetadata": {"type": "MAP"},
            }
            if platform == "google_ads":
                tag["parameter"] += [param("conversionId", "9000004"), param("conversionLabel", "SYNTHETIC_PURCHASE")]
            if platform == "meta_server":
                tag["parameter"] += [param("user_data", "{{Synthetic Match Token}}")]
            tags.append(tag)
    triggers = [{**common, "triggerId": str(i), "name": f"CE - {event}", "type": "CUSTOM_EVENT",
                 "customEventFilter": [{"type": "EQUALS", "parameter": [param("arg0", "{{_event}}"), param("arg1", event)]}],
                 "fingerprint": "synthetic-v1"} for i, event in enumerate(EVENTS, 1)]
    container = {**common, "name": "Synthetic Reference Server" if server else "Synthetic Reference Web",
                 "publicId": "GTM-SYNTHETIC", "usageContext": ["SERVER" if server else "WEB"],
                 "path": f"accounts/9000001/containers/{cid}", "fingerprint": "synthetic-v1",
                 "tagManagerUrl": "https://example.invalid/gtm", "features": {}, "tagIds": []}
    if server:
        container["taggingServerUrls"] = ["https://collect.example.invalid"]
    cv = {**common, "containerVersionId": "1", "container": container,
          "path": container["path"] + "/versions/1", "fingerprint": "synthetic-v1",
          "tagManagerUrl": "https://example.invalid/gtm", "tag": tags, "trigger": triggers,
          "variable": [{**common, "variableId": str(i), "name": name, "type": "ed" if server else "v",
                        "parameter": [param("name", key)], "fingerprint": "synthetic-v1"}
                       for i, (name, key) in enumerate([("Event ID", "event_id"), ("Synthetic Match Token", "synthetic_match_token")], 1)],
          "folder": [{**common, "folderId": "1", "name": "Synthetic", "fingerprint": "synthetic-v1"}],
          "builtInVariable": [{**common, "name": "Event", "type": "EVENT"}],
          "customTemplate": [{**common, "templateId": "1", "name": "Synthetic Meta Template — NOT EXECUTABLE",
                              "templateData": "SYNTHETIC PLACEHOLDER: no executable template code", "fingerprint": "synthetic-v1"}]}
    if server:
        cv["client"] = [{**common, "clientId": "1", "name": "Synthetic GA4 Client", "type": "gaaw_client", "parameter": [], "fingerprint": "synthetic-v1"}]
    return {"exportFormatVersion": 2, "exportTime": iso(START), "containerVersion": cv}


def purchase_tag(container, platform):
    return next(t for t in container["containerVersion"]["tag"] if t["name"] == f"{platform} - purchase")


def mutate(web, server, scenario):
    web, server = copy.deepcopy(web), copy.deepcopy(server)
    if scenario == "benign_rename":
        purchase_tag(web, "meta_browser")["name"] = "Meta - Order Confirmed"
    elif scenario == "broken_trigger_reference":
        purchase_tag(web, "meta_browser")["firingTriggerId"] = ["999"]
    elif scenario == "purchase_trigger_mismatch":
        set_param(web["containerVersion"]["trigger"][-1]["customEventFilter"][0], "arg1", "order_complete")
    elif scenario == "meta_event_id_mismatch":
        set_param(purchase_tag(server, "meta_server"), "event_id", "{{Event ID}}-server")
    elif scenario == "google_label_mismatch":
        set_param(purchase_tag(web, "google_ads"), "conversionLabel", "SYNTHETIC_WRONG_LABEL")
    elif scenario == "consent_bypass":
        purchase_tag(web, "meta_browser")["consentSettings"] = {"consentStatus": "NOT_NEEDED"}
    elif scenario == "match_data_missing":
        tag = purchase_tag(server, "meta_server")
        tag["parameter"] = [p for p in tag["parameter"] if p["key"] != "user_data"]
    for original, changed in [(make_container(), web), (make_container(True), server)]:
        if changed != original:
            changed["containerVersion"]["containerVersionId"] = "2"
            changed["exportTime"] = iso(START + timedelta(hours=DRIFT_HOUR))
    return web, server


def visitor_actions(seed, sessions_per_hour):
    rng = random.Random(seed)
    rows = []
    for hour in range(HOURS):
        for n in range(sessions_per_hour):
            sid = f"s-{hour:02d}-{n:03d}"
            channel = rng.choices(["meta", "google_ads", "organic"], [0.4, 0.4, 0.2])[0]
            consent = rng.random() >= 0.2
            depth = 1
            for probability in [0.9, 0.65, 0.75, 0.65]:
                if rng.random() >= probability:
                    break
                depth += 1
            value = rng.choice([49.0, 89.0, 149.0, 249.0])
            base = START + timedelta(hours=hour, seconds=n * (3500 // max(1, sessions_per_hour)))
            for idx, event in enumerate(EVENTS[:depth]):
                eid = f"evt-{sid}-{idx}"
                rows.append({"occurred_at": iso(base + timedelta(seconds=idx * 10)), "hour": hour,
                             "session_id": sid, "event_id": eid, "event_name": event, "channel": channel,
                             "consent": {"analytics_storage": "granted" if consent else "denied", "ad_storage": "granted" if consent else "denied"},
                             "page_url": "https://shop.example.invalid/" + ("thank-you" if event == "purchase" else "catalog"),
                             "value": value if event == "purchase" else 0.0, "currency": "USD",
                             "order_id": f"order-{sid}" if event == "purchase" else None,
                             "synthetic_match_token": hashlib.sha256(("fake-" + sid).encode()).hexdigest() if consent else None})
    return rows


def platform_for(tag):
    if tag["type"] == "awct":
        return "google_ads"
    if tag["type"] == "gaawe":
        return "ga4"
    return "meta"


def simulate(actions, containers, scenario):
    data_layer, network = [], []
    for source in actions:
        event = copy.deepcopy(source)
        changed = event["hour"] >= DRIFT_HOUR
        # Stable hash gates avoid changing unrelated visitor draws across cases.
        if scenario == "business_conversion_drop" and changed and event["event_name"] == "purchase" and int(digest(event["session_id"])[:8], 16) % 4 != 0:
            continue
        if scenario == "traffic_mix_shift" and changed:
            event["channel"] = "organic"
        data_layer.append(event)
        web, server = containers[1 if changed else 0]
        for source_name, container in [("browser", web), ("server", server)]:
            cv = container["containerVersion"]
            triggers = {t["triggerId"]: t for t in cv["trigger"]}
            for tag in cv["tag"]:
                fired = any(tid in triggers and get_param(triggers[tid]["customEventFilter"][0], "arg1") == event["event_name"] for tid in tag["firingTriggerId"])
                if not fired:
                    continue
                platform = platform_for(tag)
                consent_key = "analytics_storage" if platform == "ga4" else "ad_storage"
                if tag["consentSettings"]["consentStatus"] == "NEEDED" and event["consent"][consent_key] == "denied":
                    continue
                eid = get_param(tag, "event_id").replace("{{Event ID}}", event["event_id"])
                status = 503 if changed and scenario == "server_outage" and source_name == "server" else 200
                dispatch = dt(event["occurred_at"]) + timedelta(seconds=2 if source_name == "server" else 1)
                delay = 8 if changed and scenario == "reporting_delay" and platform == "google_ads" else 1
                network.append({"request_id": f"req-{event['event_id']}-{platform}-{source_name}",
                                "logical_event_id": event["event_id"], "event_id": eid, "event_name": event["event_name"],
                                "session_id": event["session_id"], "occurred_at": event["occurred_at"], "dispatched_at": iso(dispatch),
                                "platform": platform, "source": source_name, "http_status": status,
                                "container_version_id": cv["containerVersionId"], "tag_id": tag["tagId"],
                                "channel": event["channel"], "consent": event["consent"], "value": event["value"], "currency": "USD",
                                "conversion_label": get_param(tag, "conversionLabel") if platform == "google_ads" else None,
                                "match_fields_present": bool(event["synthetic_match_token"]) and (source_name == "browser" or get_param(tag, "user_data") is not None),
                                # Scheduled report visibility belongs to the simulator's private state.
                                "_available_at": iso(dispatch + timedelta(hours=delay))})
    return data_layer, network


def snapshots(network, actions):
    result = []
    # Incremental as-of snapshots and a settled snapshot distinguish delay from loss.
    for elapsed in [24, 30, 48, 60]:
        observed = START + timedelta(hours=elapsed)
        available = [n for n in network if n["http_status"] == 200 and dt(n["_available_at"]) <= observed]
        for window, low, high in [("before", 0, 24), ("after", 24, 48)]:
            if elapsed <= low:
                continue
            eligible = [n for n in available if low <= (dt(n["occurred_at"]) - START).total_seconds() / 3600 < high]
            for platform in ["meta", "google_ads"]:
                rows = [n for n in eligible if n["platform"] == platform]
                if platform == "google_ads":
                    rows = [n for n in rows if n["conversion_label"] == "SYNTHETIC_PURCHASE"]
                events = []
                for event in (EVENTS if platform == "meta" else ["purchase"]):
                    subset = [n for n in rows if n["event_name"] == event]
                    unique = {(n["event_name"], n["event_id"]): n for n in subset}
                    attributed = [n for n in unique.values() if n["channel"] == platform and n["consent"]["ad_storage"] == "granted"]
                    browser = {n["event_id"] for n in subset if n["source"] == "browser"}
                    server = {n["event_id"] for n in subset if n["source"] == "server"}
                    srv = [n for n in subset if n["source"] == "server"]
                    events.append({"event_name": event, "received_requests": len(subset), "unique_events": len(unique),
                                   "browser_events": len(browser), "server_events": len(server),
                                   "browser_server_overlap": len(browser & server),
                                   "server_dedup_overlap_rate": len(browser & server) / len(server) if server else None,
                                   "attributed_conversions": len(attributed),
                                   "attributed_value": round(sum(n["value"] for n in attributed), 2),
                                   "simulated_emq_proxy": round(2 + 6 * sum(n["match_fields_present"] for n in srv) / len(srv), 2) if srv else None})
                visits = {a["session_id"] for a in actions if a["channel"] == platform and low <= a["hour"] < high and dt(a["occurred_at"]) < observed}
                result.append({"schema_version": VERSION, "observed_at": iso(observed), "event_window": window,
                               "window_start": iso(START + timedelta(hours=low)), "window_end_exclusive": iso(START + timedelta(hours=high)),
                               "platform": platform, "currency": "USD", "synthetic_clicks": len(visits),
                               "synthetic_spend": round(len(visits) * (1.2 if platform == "meta" else 1.8), 2),
                               "attribution_model": "simulated_last_paid_channel_no_cross_device",
                               "conversion_actions": [{"id": "9000004", "label": "SYNTHETIC_PURCHASE", "category": "PURCHASE", "status": "ENABLED"}] if platform == "google_ads" else [],
                               "events": events})
    return result


def diff_paths(a, b, path=""):
    if type(a) is not type(b):
        return [path]
    if isinstance(a, dict):
        out = []
        for key in sorted(a.keys() | b.keys()):
            child = path + "/" + key.replace("~", "~0").replace("/", "~1")
            out += [child] if key not in a or key not in b else diff_paths(a[key], b[key], child)
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [path]
        return [p for i, (x, y) in enumerate(zip(a, b)) for p in diff_paths(x, y, path + "/" + str(i))]
    return [] if a == b else [path]


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(canonical(row) + "\n" for row in rows))


def build_case(seed, sessions_per_hour, scenario):
    before = (make_container(), make_container(True))
    after = mutate(*before, scenario)
    actions, network = simulate(visitor_actions(seed, sessions_per_hour), [before, after], scenario)
    return before, after, actions, network, snapshots(network, actions)


def generate(output, seed=20260921, sessions_per_hour=12):
    if output.exists():
        raise ValueError(f"Output already exists; choose a new path: {output}")
    output.mkdir(parents=True)
    manifest = {"schema_version": VERSION, "synthetic": True, "seed": seed, "hours": HOURS,
                "sessions_per_hour": sessions_per_hour, "cases": [],
                "lineage_group": f"synthetic-lineage-{seed}",
                "warning": "All cases share a paired baseline. Keep this entire seed group in one dataset split."}
    for idx, (scenario, fault, description) in enumerate(SCENARIOS, 1):
        case_id = f"case-{idx:03d}"
        before, after, actions, network, reports = build_case(seed, sessions_per_hour, scenario)
        path = output / "observations" / case_id
        for i, side in enumerate(["web", "server"]):
            write_json(path / f"{side}-before.json", before[i])
            write_json(path / f"{side}-after.json", after[i])
        write_json(path / "container-history.json", [{"effective_at": iso(START), "web_hash": digest(before[0]), "server_hash": digest(before[1])},
                                                     {"effective_at": iso(START + timedelta(hours=24)), "web_hash": digest(after[0]), "server_hash": digest(after[1])}])
        write_jsonl(path / "data-layer.jsonl", actions)
        public_network = [{k: v for k, v in n.items() if not k.startswith("_")} for n in network]
        write_jsonl(path / "network-events.jsonl", public_network)
        write_jsonl(path / "platform-snapshots.jsonl", reports)
        manifest["cases"].append({"case_id": case_id, "directory": f"observations/{case_id}", "visitor_events": len(actions), "network_requests": len(network)})
        consent_leaks = sum(n["consent"]["ad_storage"] == "denied" and n["platform"] in ["meta", "google_ads"] for n in network)
        write_json(output / "ground-truth" / f"{case_id}.json", {
            "label_provenance": "synthetic_generator_rule_not_human_reviewed", "case_id": case_id,
            "scenario": scenario, "fault_category": fault, "description": description,
            "injected_at": None if scenario == "healthy" else iso(START + timedelta(hours=24)),
            "web_changed_paths": diff_paths(before[0], after[0]), "server_changed_paths": diff_paths(before[1], after[1]),
            "consent_violating_requests": consent_leaks,
            "business_purchases": sum(a["event_name"] == "purchase" for a in actions),
            "expected_structural_validity": scenario != "broken_trigger_reference",
            "expected_container_tracking_fault": fault in ["structural_container_fault", "semantic_container_fault"],
            "caution": "Injected cause is an oracle label. A judge may correctly abstain when its supplied evidence is insufficient."})
    write_json(output / "manifest.json", manifest)
    # Hash inventory excludes itself and truth is explicitly segregated.
    write_json(output / "checksums.json", {str(p.relative_to(output)): hashlib.sha256(p.read_bytes()).hexdigest()
                                           for p in sorted(output.rglob("*")) if p.is_file()})
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20260921)
    parser.add_argument("--sessions-per-hour", type=int, default=12)
    args = parser.parse_args()
    if not 1 <= args.sessions_per_hour <= 60:
        parser.error("--sessions-per-hour must be between 1 and 60")
    manifest = generate(args.output, args.seed, args.sessions_per_hour)
    print(json.dumps({"output": str(args.output.resolve()), "cases": len(manifest["cases"]),
                      "visitor_events": sum(c["visitor_events"] for c in manifest["cases"]),
                      "network_requests": sum(c["network_requests"] for c in manifest["cases"])}, indent=2))


if __name__ == "__main__":
    main()
