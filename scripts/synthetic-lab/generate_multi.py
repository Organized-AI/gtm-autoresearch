"""Offline multi-topology GTM corpus. No vendor APIs or executable GTM templates."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import random
import re
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

from generate import (START, HOURS, DRIFT_HOUR, iso, dt, digest, param, set_param,
                      get_param, make_container, diff_paths, write_json, write_jsonl)

VERSION = "2.0.0"


@dataclass(frozen=True)
class Topology:
    key: str
    events: tuple[str, ...]
    category: str
    split: str
    transport: str
    extra_fault: str
    description: str

    @property
    def conversion(self):
        return self.events[-1]

    @property
    def label(self):
        return "SYNTHETIC_" + self.conversion.upper()


# This assignment is authored before generation, never selected from outcomes/scores.
TOPOLOGIES = {
    "retail": Topology("retail", ("page_view", "view_item", "add_to_cart", "begin_checkout", "purchase"),
                       "PURCHASE", "train", "independent", "checkout_trigger_mismatch",
                       "One trigger per event; browser GA4/Meta/Ads and an independent server Meta feed."),
    "leadgen": Topology("leadgen", ("page_view", "form_start", "form_submit", "generate_lead"),
                        "SUBMIT_LEAD_FORM", "validation", "forwarded", "client_claim_mismatch",
                        "Shared regex triggers and dynamic event names; server receives successful browser GA4 events."),
    "subscription": Topology("subscription", ("page_view", "view_pricing", "start_trial", "subscribe"),
                             "SUBSCRIBE_PAID", "holdout", "hybrid", "branch_filter_removed",
                             "Plan-specific browser triggers; GA4 forwarding plus a separate billing client; server Ads conversions."),
}
COMMON_SCENARIOS = (
    ("healthy", "none"), ("benign_rename", "benign_container_drift"),
    ("broken_trigger_reference", "structural_container_fault"),
    ("conversion_trigger_mismatch", "semantic_container_fault"),
    ("meta_event_id_mismatch", "semantic_container_fault"),
    ("google_label_mismatch", "semantic_container_fault"),
    ("consent_bypass", "semantic_container_fault"),
    ("server_outage", "transport_fault"), ("match_data_missing", "semantic_container_fault"),
    ("business_conversion_drop", "business_change"), ("reporting_delay", "reporting_latency"),
    ("traffic_mix_shift", "traffic_change"),
)


def condition(key, value, kind="EQUALS"):
    return {"type": kind, "parameter": [param("arg0", "{{" + key + "}}"), param("arg1", value)]}


def scaffold(p, server):
    result = make_container(server)
    cv = result["containerVersion"]
    number = list(TOPOLOGIES).index(p.key) + 1
    cid = str(9200000 + number * 10 + int(server))
    # Recreate the identity envelope without inheriting any client configuration.
    def rewrite(value):
        if isinstance(value, dict):
            return {k: (cid if k == "containerId" else rewrite(v)) for k, v in value.items()}
        if isinstance(value, list):
            return [rewrite(v) for v in value]
        if isinstance(value, str):
            return value.replace("9000003" if server else "9000002", cid)
        return value
    result = rewrite(result)
    cv = result["containerVersion"]
    cv["container"]["name"] = f"Synthetic {p.key} {'server' if server else 'web'}"
    cv["container"]["publicId"] = f"GTM-SYNTH-{number}{int(server)}"
    cv["tag"], cv["trigger"] = [], []
    for index, name in enumerate(["ad_storage", "plan"], 3):
        cv["variable"].append({"accountId": cv["accountId"], "containerId": cid, "variableId": str(index),
                               "name": name, "type": "ed" if server else "v", "parameter": [param("name", name)]})
    if server:
        transports = ["independent"] if p.transport == "independent" else (["ga4"] if p.transport == "forwarded" else ["ga4", "billing"])
        cv["client"] = [{"accountId": cv["accountId"], "containerId": cid, "clientId": str(i),
                          "name": f"Synthetic {transport} client", "type": "cvt_9000001_1",
                          "parameter": [param("transport", transport)]} for i, transport in enumerate(transports, 1)]
    return result


def add_trigger(container, trigger_id, event, regex=False, filters=()):
    cv = container["containerVersion"]
    cv["trigger"].append({"accountId": cv["accountId"], "containerId": cv["containerId"],
                          "triggerId": str(trigger_id), "name": "CE - " + event, "type": "CUSTOM_EVENT",
                          "customEventFilter": [condition("_event", event, "MATCH_REGEX" if regex else "EQUALS")],
                          "filter": list(filters)})


def add_tag(container, platform, event, trigger_ids, name=None, blocked=False):
    cv = container["containerVersion"]
    server = cv["container"]["usageContext"] == ["SERVER"]
    tag = {"accountId": cv["accountId"], "containerId": cv["containerId"], "tagId": str(100 + len(cv["tag"])),
           "name": name or f"{platform} - {event}", "type": {"meta": "cvt_9000001_1", "ga4": "gaawe", "google_ads": "awct"}[platform],
           "parameter": [param("eventName", event), param("event_id", "{{Event ID}}")],
           "firingTriggerId": [str(i) for i in trigger_ids], "tagFiringOption": "ONCE_PER_EVENT", "parentFolderId": "1",
           "consentSettings": {"consentStatus": "NEEDED", "consentType": {"type": "LIST", "list": [{"type": "TEMPLATE", "value": "analytics_storage" if platform == "ga4" else "ad_storage"}]}}}
    if server and platform == "meta":
        tag["parameter"].append(param("user_data", "{{Synthetic Match Token}}"))
    if blocked and platform != "ga4":
        tag["blockingTriggerId"] = ["90"]
    cv["tag"].append(tag)
    return tag


def make_topology(p):
    web, server = scaffold(p, False), scaffold(p, True)
    if p.key == "retail":
        for i, event in enumerate(p.events, 1):
            for c in (web, server):
                add_trigger(c, i, event)
            add_tag(web, "ga4", event, [i])
            add_tag(web, "meta", event, [i])
            add_tag(server, "meta", event, [i])
        gads = add_tag(web, "google_ads", p.conversion, [len(p.events)])
    elif p.key == "leadgen":
        for c in (web, server):
            add_trigger(c, 1, "^(" + "|".join(p.events) + ")$", regex=True)
            add_trigger(c, 2, p.conversion)
            add_trigger(c, 90, ".*", regex=True, filters=[condition("ad_storage", "denied")])
        add_tag(web, "ga4", "{{Event}}", [1])
        add_tag(web, "meta", "{{Event}}", [1], blocked=True)
        add_tag(server, "meta", "{{Event}}", [1], blocked=True)
        gads = add_tag(web, "google_ads", p.conversion, [2], blocked=True)
    else:
        # Two conversion branches test routing filters and duplicate dispatch independently of Ads.
        for i, event in enumerate(p.events[:-1], 1):
            add_trigger(web, i, event)
            add_tag(web, "ga4", event, [i])
            add_tag(web, "meta", event, [i])
        for i, plan in enumerate(("monthly", "annual"), 20):
            add_trigger(web, i, p.conversion, filters=[condition("plan", plan)])
            add_tag(web, "ga4", p.conversion, [i], name=f"GA4 - subscription {plan}")
        add_trigger(server, 1, "^(" + "|".join(p.events) + ")$", regex=True)
        add_trigger(server, 2, p.conversion)
        add_tag(server, "meta", "{{Event}}", [1])
        gads = add_tag(server, "google_ads", p.conversion, [2])
    gads["parameter"] += [param("conversionId", "9200099"), param("conversionLabel", p.label)]
    return web, server


def platform_for(tag):
    return {"awct": "google_ads", "gaawe": "ga4", "cvt_9000001_1": "meta"}[tag["type"]]


def find_tag(container, platform, event=None):
    return next(t for t in container["containerVersion"]["tag"] if platform_for(t) == platform
                and (event is None or get_param(t, "eventName") in (event, "{{Event}}")))


def mutate(p, before, scenario):
    web, server = copy.deepcopy(before)
    gads_side = server if p.key == "subscription" else web
    target = p.events[-2] if p.key == "subscription" else p.conversion
    if scenario == "benign_rename":
        find_tag(web, "meta", target)["name"] = "Meta - updated reporting name"
    elif scenario == "broken_trigger_reference":
        find_tag(web, "meta", target)["firingTriggerId"] = ["999"]
    elif scenario == "conversion_trigger_mismatch":
        trigger_id = find_tag(gads_side, "google_ads")["firingTriggerId"][0]
        trigger = next(t for t in gads_side["containerVersion"]["trigger"] if t["triggerId"] == trigger_id)
        set_param(trigger["customEventFilter"][0], "arg1", "unobserved_conversion")
    elif scenario == "meta_event_id_mismatch":
        set_param(find_tag(server, "meta", target), "event_id", "{{Event ID}}-server")
    elif scenario == "google_label_mismatch":
        set_param(find_tag(gads_side, "google_ads"), "conversionLabel", "SYNTHETIC_WRONG_LABEL")
    elif scenario == "consent_bypass":
        tag = find_tag(web, "meta", target)
        tag["consentSettings"] = {"consentStatus": "NOT_NEEDED"}
        tag.pop("blockingTriggerId", None)
    elif scenario == "match_data_missing":
        tag = find_tag(server, "meta", target)
        tag["parameter"] = [item for item in tag["parameter"] if item["key"] != "user_data"]
    elif scenario == "checkout_trigger_mismatch":
        trigger = next(t for t in web["containerVersion"]["trigger"] if get_param(t["customEventFilter"][0], "arg1") == "begin_checkout")
        set_param(trigger["customEventFilter"][0], "arg1", "unobserved_checkout")
    elif scenario == "client_claim_mismatch":
        set_param(server["containerVersion"]["client"][0], "transport", "unrecognized")
    elif scenario == "branch_filter_removed":
        next(t for t in web["containerVersion"]["trigger"] if t["triggerId"] == "20")["filter"] = []
    for original, changed in zip(before, (web, server)):
        if original != changed:
            changed["containerVersion"]["containerVersionId"] = "2"
            changed["containerVersion"]["path"] = changed["containerVersion"]["path"].rsplit("/", 1)[0] + "/2"
            changed["exportTime"] = iso(START + timedelta(hours=DRIFT_HOUR))
    return web, server


def visitor_actions(p, seed, sessions_per_hour):
    # Independent random populations across topology families; paired across injected cases.
    rng = random.Random(int(digest([p.key, seed])[:16], 16))
    rows = []
    for hour in range(HOURS):
        for n in range(sessions_per_hour):
            sid = f"s-{p.key}-{seed}-{hour:02d}-{n:03d}"
            channel = rng.choices(["meta", "google_ads", "organic"], [0.4, 0.4, 0.2])[0]
            consent, plan = rng.random() >= 0.2, rng.choice(["monthly", "annual"])
            depth = 1
            for probability in ([0.9, 0.65, 0.75, 0.65] if p.key == "retail" else [0.85, 0.7, 0.6]):
                if rng.random() >= probability:
                    break
                depth += 1
            value = rng.choice([49, 89, 149, 249]) if p.key == "retail" else (25 if p.key == "leadgen" else (20 if plan == "monthly" else 200))
            base = START + timedelta(hours=hour, seconds=n * (3500 // sessions_per_hour))
            for idx, event in enumerate(p.events[:depth]):
                rows.append({"occurred_at": iso(base + timedelta(seconds=10 * idx)), "hour": hour,
                             "session_id": sid, "event_id": f"evt-{sid}-{idx}", "event_name": event,
                             "channel": channel, "plan": plan, "value": value if event == p.conversion else 0, "currency": "USD",
                             "page_url": f"https://{p.key}.example.invalid/" + ("complete" if event == p.conversion else "start"),
                             "consent": {"analytics_storage": "granted" if consent else "denied", "ad_storage": "granted" if consent else "denied"},
                             "synthetic_match_token": digest("fictional-" + sid) if consent else None})
    return rows


def value_for(expression, event):
    values = {"_event": event["event_name"], "Event": event["event_name"], "Event ID": event["event_id"],
              "plan": event["plan"], "ad_storage": event["consent"]["ad_storage"]}
    return re.sub(r"\{\{([^}]+)\}\}", lambda match: str(values.get(match[1], "")), expression)


def matches(trigger, event):
    for f in trigger.get("customEventFilter", []) + trigger.get("filter", []):
        actual, expected = value_for(get_param(f, "arg0"), event), get_param(f, "arg1")
        if f["type"] == "EQUALS" and actual != expected:
            return False
        if f["type"] == "MATCH_REGEX" and re.fullmatch(expected, actual) is None:
            return False
        if f["type"] not in ("EQUALS", "MATCH_REGEX"):
            raise ValueError("unsupported synthetic filter")
    return True


def simulate(p, actions, containers, scenario):
    data, network = [], []
    for source in actions:
        event = copy.deepcopy(source)
        changed = event["hour"] >= DRIFT_HOUR
        if changed and scenario == "business_conversion_drop" and event["event_name"] == p.conversion and int(digest(event["session_id"])[:8], 16) % 4:
            continue
        if changed and scenario == "traffic_mix_shift":
            event["channel"] = "organic"
        data.append(event)
        web, server = containers[int(changed)]
        browser_ga4 = False
        for side, container in (("browser", web), ("server", server)):
            cv = container["containerVersion"]
            if side == "server":
                transport = "independent" if p.transport == "independent" else ("billing" if p.transport == "hybrid" and event["event_name"] == p.conversion else "ga4")
                if transport == "ga4" and not browser_ga4:
                    continue
                if not any(get_param(client, "transport") == transport for client in cv["client"]):
                    continue
            triggers = {t["triggerId"]: t for t in cv["trigger"]}
            for tag in cv["tag"]:
                if not any(tid in triggers and matches(triggers[tid], event) for tid in tag["firingTriggerId"]):
                    continue
                if any(tid in triggers and matches(triggers[tid], event) for tid in tag.get("blockingTriggerId", [])):
                    continue
                platform = platform_for(tag)
                consent_key = "analytics_storage" if platform == "ga4" else "ad_storage"
                if tag["consentSettings"]["consentStatus"] == "NEEDED" and event["consent"][consent_key] == "denied":
                    continue
                status = 503 if changed and scenario == "server_outage" and side == "server" else 200
                if side == "browser" and platform == "ga4" and status == 200:
                    browser_ga4 = True
                dispatched = dt(event["occurred_at"]) + timedelta(seconds=1 if side == "browser" else 2)
                delay = 8 if changed and scenario == "reporting_delay" and platform == "google_ads" else 1
                network.append({"request_id": f"req-{event['event_id']}-{side}-{tag['tagId']}", "logical_event_id": event["event_id"],
                                "event_id": value_for(get_param(tag, "event_id"), event), "event_name": value_for(get_param(tag, "eventName"), event),
                                "session_id": event["session_id"], "occurred_at": event["occurred_at"], "dispatched_at": iso(dispatched),
                                "platform": platform, "source": side, "http_status": status,
                                "container_version_id": cv["containerVersionId"], "tag_id": tag["tagId"],
                                "channel": event["channel"], "consent": event["consent"], "value": event["value"], "currency": "USD",
                                "conversion_label": get_param(tag, "conversionLabel") if platform == "google_ads" else None,
                                "match_fields_present": bool(event["synthetic_match_token"]) and (side == "browser" or get_param(tag, "user_data") is not None),
                                "_available_at": iso(dispatched + timedelta(hours=delay))})
    return data, network


def snapshots(p, network, actions):
    result = []
    for elapsed in (24, 30, 48, 60):
        observed = START + timedelta(hours=elapsed)
        available = [n for n in network if n["http_status"] == 200 and dt(n["_available_at"]) <= observed]
        for window, low, high in (("before", 0, 24), ("after", 24, 48)):
            if elapsed <= low:
                continue
            for platform in ("meta", "google_ads"):
                rows = [n for n in available if n["platform"] == platform and low <= (dt(n["occurred_at"]) - START).total_seconds() / 3600 < high
                        and (platform != "google_ads" or n["conversion_label"] == p.label)]
                events = []
                for event in (p.events if platform == "meta" else (p.conversion,)):
                    subset = [n for n in rows if n["event_name"] == event]
                    unique = {(n["event_name"], n["event_id"]): n for n in subset}
                    attributed = [n for n in unique.values() if n["channel"] == platform]
                    browser = {n["event_id"] for n in subset if n["source"] == "browser"}
                    server = {n["event_id"] for n in subset if n["source"] == "server"}
                    srv = [n for n in subset if n["source"] == "server"]
                    events.append({"event_name": event, "received_requests": len(subset), "unique_events": len(unique),
                                   "browser_events": len(browser), "server_events": len(server), "browser_server_overlap": len(browser & server),
                                   "server_dedup_overlap_rate": len(browser & server) / len(server) if server else None,
                                   "attributed_conversions": len(attributed), "attributed_value": sum(n["value"] for n in attributed),
                                   "simulated_emq_proxy": round(2 + 6 * sum(n["match_fields_present"] for n in srv) / len(srv), 2) if srv else None})
                visits = {a["session_id"] for a in actions if a["channel"] == platform and low <= a["hour"] < high and dt(a["occurred_at"]) < observed}
                result.append({"schema_version": VERSION, "observed_at": iso(observed), "event_window": window,
                               "window_start": iso(START + timedelta(hours=low)), "window_end_exclusive": iso(START + timedelta(hours=high)),
                               "platform": platform, "currency": "USD", "synthetic_clicks": len(visits),
                               "synthetic_spend": round(len(visits) * (1.2 if platform == "meta" else 1.8), 2),
                               "attribution_model": "simulated_last_paid_channel_no_cross_device",
                               "conversion_actions": [{"id": "9200099", "label": p.label, "category": p.category, "status": "ENABLED"}] if platform == "google_ads" else [], "events": events})
    return result


def build_case(p, seed, sessions_per_hour, scenario):
    allowed = {name for name, _ in COMMON_SCENARIOS} | {p.extra_fault}
    if scenario not in allowed:
        raise ValueError(f"unsupported scenario for {p.key}: {scenario}")
    before = make_topology(p)
    after = mutate(p, before, scenario)
    actions, network = simulate(p, visitor_actions(p, seed, sessions_per_hour), (before, after), scenario)
    return before, after, actions, network, snapshots(p, network, actions)


def generate(output, seeds=(20260921, 20260922), sessions_per_hour=8):
    if not seeds or len(set(seeds)) != len(seeds):
        raise ValueError("seeds must be nonempty and unique")
    if not 1 <= sessions_per_hour <= 60:
        raise ValueError("sessions_per_hour must be between 1 and 60")
    if output.exists():
        raise ValueError(f"Output already exists; choose a new path: {output}")
    output.mkdir(parents=True)
    manifest = {"schema_version": VERSION, "synthetic": True, "seeds": list(seeds), "hours": HOURS,
                "sessions_per_hour": sessions_per_hour, "split_policy": "authored_topology_families_v1", "cases": [],
                "topologies": [{"topology_group": f"synthetic-{p.key}-v1", "split": p.split, "description": p.description} for p in TOPOLOGIES.values()],
                "warning": "Paired cases and all seeds of a topology must stay together. Recipes share a simulator; no calibration or generalization claim."}
    for p in TOPOLOGIES.values():
        for seed in seeds:
            scenarios = list(COMMON_SCENARIOS) + [(p.extra_fault, "semantic_container_fault")]
            # Opaque case identities/order must not encode the scenario for the model.
            random.Random(int(digest([p.key, seed, "order"])[:16], 16)).shuffle(scenarios)
            for scenario, fault in scenarios:
                case_id = "case-" + digest([p.key, seed, scenario])[:16]
                before, after, actions, network, reports = build_case(p, seed, sessions_per_hour, scenario)
                base = output / "observations" / case_id
                for i, side in enumerate(("web", "server")):
                    write_json(base / f"{side}-before.json", before[i])
                    write_json(base / f"{side}-after.json", after[i])
                write_json(base / "container-history.json", [
                    {"effective_at": iso(START), "web_hash": digest(before[0]), "server_hash": digest(before[1])},
                    {"effective_at": iso(START + timedelta(hours=DRIFT_HOUR)), "web_hash": digest(after[0]), "server_hash": digest(after[1])}])
                write_jsonl(base / "data-layer.jsonl", actions)
                write_jsonl(base / "network-events.jsonl", [{k: v for k, v in n.items() if not k.startswith("_")} for n in network])
                write_jsonl(base / "platform-snapshots.jsonl", reports)
                manifest["cases"].append({"case_id": case_id, "directory": "observations/" + case_id,
                                           "topology_group": f"synthetic-{p.key}-v1", "container_group": "containers-" + digest(before),
                                           "lineage_group": f"synthetic-{p.key}-seed-{seed}", "split": p.split,
                                           "visitor_events": len(actions), "network_requests": len(network)})
                write_json(output / "ground-truth" / (case_id + ".json"), {
                    "label_provenance": "synthetic_generator_rule_not_human_reviewed", "case_id": case_id,
                    "scenario": scenario, "fault_category": fault, "conversion_event": p.conversion,
                    "injected_at": None if scenario == "healthy" else iso(START + timedelta(hours=DRIFT_HOUR)),
                    "web_changed_paths": diff_paths(before[0], after[0]), "server_changed_paths": diff_paths(before[1], after[1]),
                    "expected_structural_validity": scenario != "broken_trigger_reference",
                    "expected_container_tracking_fault": fault in ("structural_container_fault", "semantic_container_fault"),
                    "caution": "Generator truth is not necessarily inferable at an early cutoff; abstention is permitted."})
    write_json(output / "manifest.json", manifest)
    write_json(output / "checksums.json", {str(p.relative_to(output)): hashlib.sha256(p.read_bytes()).hexdigest()
                                           for p in sorted(output.rglob("*")) if p.is_file()})
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, action="append", dest="seeds")
    parser.add_argument("--sessions-per-hour", type=int, default=8)
    args = parser.parse_args()
    try:
        manifest = generate(args.output, args.seeds or (20260921, 20260922), args.sessions_per_hour)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps({"output": str(args.output.resolve()), "cases": len(manifest["cases"]), "topologies": len(TOPOLOGIES),
                      "lineages": len({c["lineage_group"] for c in manifest["cases"]}),
                      "visitor_events": sum(c["visitor_events"] for c in manifest["cases"]),
                      "network_requests": sum(c["network_requests"] for c in manifest["cases"])}, indent=2))


if __name__ == "__main__":
    main()
