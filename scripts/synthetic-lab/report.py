"""Create an oracle-only scenario summary; never supply this report to the judge."""
import argparse
import json
from pathlib import Path


def report(root):
    manifest = json.loads((root / "manifest.json").read_text())
    lines = ["# Synthetic GTM simulation report", "", "Evaluation-only: includes injected ground truth. Do not give this file to Jev.", "",
             "Counts below use the after-change event window and the settled (60-hour) snapshot. Meta totals are consent-eligible events after event-ID deduplication, including organic visitors; attributed counts are a subset.", "",
             "| Case | Injected scenario | Conversion event | Visitor conversions | Meta unique conversions | Google matched conversions | Meta attributed | Google attributed |", "|---|---|---|---:|---:|---:|---:|---:|"]
    for case in manifest["cases"]:
        cid = case["case_id"]
        folder = root / case["directory"]
        truth = json.loads((root / "ground-truth" / f"{cid}.json").read_text())
        conversion = truth.get("conversion_event", "purchase")
        events = [json.loads(line) for line in (folder / "data-layer.jsonl").read_text().splitlines()]
        snapshots = [json.loads(line) for line in (folder / "platform-snapshots.jsonl").read_text().splitlines()]
        latest = max(s["observed_at"] for s in snapshots)
        selected = {s["platform"]: next(e for e in s["events"] if e["event_name"] == conversion) for s in snapshots if s["observed_at"] == latest and s["event_window"] == "after"}
        meta, google = selected["meta"], selected["google_ads"]
        purchases = sum(e["hour"] >= 24 and e["event_name"] == conversion for e in events)
        lines.append(f"| {cid} | {truth['scenario']} | {conversion} | {purchases} | {meta['unique_events']} | {google['unique_events']} | {meta['attributed_conversions']} | {google['attributed_conversions']} |")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    args = parser.parse_args()
    destination = args.dataset / "ORACLE-REPORT.md"
    destination.write_text(report(args.dataset))
    print(destination.resolve())
