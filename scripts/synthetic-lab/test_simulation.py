import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from generate import build_case, digest, generate, SCENARIOS


class SimulationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = {name: build_case(20260921, 12, name) for name, _, _ in SCENARIOS}

    def settled(self, name, platform, event="purchase", window="after"):
        reports = self.cases[name][-1]
        last = max(r["observed_at"] for r in reports)
        report = next(r for r in reports if r["observed_at"] == last and r["platform"] == platform and r["event_window"] == window)
        return next(e for e in report["events"] if e["event_name"] == event)

    def test_healthy_dedup_and_attribution(self):
        before, after, actions, network, _ = self.cases["healthy"]
        self.assertEqual(before, after)
        meta = self.settled("healthy", "meta")
        eligible = [a for a in actions if a["hour"] >= 24 and a["event_name"] == "purchase" and a["consent"]["ad_storage"] == "granted"]
        self.assertGreater(len(eligible), 0)
        self.assertEqual(meta["unique_events"], len(eligible))
        self.assertEqual(meta["received_requests"], 2 * len(eligible))
        self.assertEqual(meta["server_dedup_overlap_rate"], 1)
        self.assertEqual(meta["attributed_conversions"], sum(a["channel"] == "meta" for a in eligible))
        self.assertTrue(all(n["consent"]["ad_storage"] == "granted" for n in network))

    def test_rename_has_no_behavioral_effect(self):
        healthy, renamed = self.cases["healthy"], self.cases["benign_rename"]
        self.assertEqual(healthy[2], renamed[2])
        self.assertEqual(healthy[4], renamed[4])
        self.assertNotEqual(renamed[0], renamed[1])

    def test_broken_reference_is_only_structural_fault(self):
        for name, data in self.cases.items():
            bad = []
            for container in data[1]:
                cv = container["containerVersion"]
                ids = {t["triggerId"] for t in cv["trigger"]}
                bad.extend(tid for tag in cv["tag"] for tid in tag["firingTriggerId"] if tid not in ids)
            self.assertEqual(bool(bad), name == "broken_trigger_reference", name)

    def test_semantic_fault_preserves_json_shape(self):
        before, after, *_ = self.cases["purchase_trigger_mismatch"]
        for i in range(2):
            self.assertEqual(set(before[i]), set(after[i]))
            self.assertEqual(set(before[i]["containerVersion"]), set(after[i]["containerVersion"]))
        self.assertEqual(self.settled("purchase_trigger_mismatch", "google_ads")["unique_events"], 0)
        self.assertEqual(self.settled("purchase_trigger_mismatch", "meta")["browser_events"], 0)
        self.assertGreater(self.settled("purchase_trigger_mismatch", "meta")["server_events"], 0)

    def test_id_mismatch_inflates_meta_only(self):
        healthy = self.settled("healthy", "meta")
        fault = self.settled("meta_event_id_mismatch", "meta")
        self.assertEqual(fault["unique_events"], healthy["unique_events"] * 2)
        self.assertEqual(fault["received_requests"], healthy["received_requests"])
        self.assertEqual(fault["server_dedup_overlap_rate"], 0)
        self.assertEqual(self.settled("meta_event_id_mismatch", "google_ads"), self.settled("healthy", "google_ads"))

    def test_wrong_label_does_not_equal_transport_failure(self):
        self.assertEqual(self.settled("google_label_mismatch", "google_ads")["unique_events"], 0)
        requests = [n for n in self.cases["google_label_mismatch"][3] if n["platform"] == "google_ads" and n["conversion_label"] == "SYNTHETIC_WRONG_LABEL"]
        self.assertGreater(len(requests), 0)
        self.assertTrue(all(n["http_status"] == 200 for n in requests))

    def test_consent_leak_is_confined_to_injected_fault(self):
        for name, case in self.cases.items():
            leaks = [n for n in case[3] if n["platform"] in ["meta", "google_ads"] and n["consent"]["ad_storage"] == "denied"]
            self.assertEqual(bool(leaks), name == "consent_bypass", name)
            if leaks:
                self.assertTrue(all(n["source"] == "browser" and n["platform"] == "meta" and n["event_name"] == "purchase" for n in leaks))

    def test_outage_without_config_change(self):
        before, after, _, network, _ = self.cases["server_outage"]
        self.assertEqual(before, after)
        self.assertTrue(any(n["http_status"] == 503 for n in network))
        self.assertEqual(self.settled("server_outage", "meta")["server_events"], 0)

    def test_match_quality_drop_without_count_drop(self):
        good, bad = self.settled("healthy", "meta"), self.settled("match_data_missing", "meta")
        self.assertEqual(good["unique_events"], bad["unique_events"])
        self.assertLess(bad["simulated_emq_proxy"], good["simulated_emq_proxy"])

    def test_business_drop_is_not_missing_delivery(self):
        case = self.cases["business_conversion_drop"]
        self.assertEqual(case[0], case[1])
        self.assertLess(self.settled("business_conversion_drop", "meta")["unique_events"], self.settled("healthy", "meta")["unique_events"])
        actual = sum(a["hour"] >= 24 and a["event_name"] == "purchase" and a["consent"]["ad_storage"] == "granted" for a in case[2])
        self.assertEqual(actual, self.settled("business_conversion_drop", "meta")["unique_events"])

    def test_reporting_delay_catches_up(self):
        case = self.cases["reporting_delay"]
        self.assertEqual(case[0], case[1])
        healthy = next(r for r in self.cases["healthy"][4] if r["observed_at"] == "2026-01-03T00:00:00Z" and r["platform"] == "google_ads" and r["event_window"] == "after")
        delayed = next(r for r in case[4] if r["observed_at"] == healthy["observed_at"] and r["platform"] == "google_ads" and r["event_window"] == "after")
        self.assertLess(delayed["events"][0]["unique_events"], healthy["events"][0]["unique_events"])
        self.assertEqual(self.settled("reporting_delay", "google_ads"), self.settled("healthy", "google_ads"))

    def test_traffic_mix_changes_attribution_not_total_events(self):
        self.assertEqual(self.cases["traffic_mix_shift"][0], self.cases["traffic_mix_shift"][1])
        for platform in ["meta", "google_ads"]:
            shifted, healthy = self.settled("traffic_mix_shift", platform), self.settled("healthy", platform)
            self.assertEqual(shifted["unique_events"], healthy["unique_events"])
            self.assertEqual(shifted["attributed_conversions"], 0)

    def test_all_cases_share_identical_pre_drift_evidence(self):
        def early(case):
            return [{k: v for k, v in n.items()} for n in case[3] if n["occurred_at"] < "2026-01-02T00:00:00Z"]
        for case in self.cases.values():
            self.assertEqual(early(case), early(self.cases["healthy"]))

    def test_generated_files_reproducible_and_truth_separate(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = Path(tmp) / "a", Path(tmp) / "b"
            generate(a, 77, 2)
            generate(b, 77, 2)
            self.assertEqual((a / "checksums.json").read_bytes(), (b / "checksums.json").read_bytes())
            checks = json.loads((a / "checksums.json").read_text())
            for rel, expected in checks.items():
                self.assertEqual(hashlib.sha256((a / rel).read_bytes()).hexdigest(), expected)
            for path in (a / "observations").rglob("*.json*"):
                text = path.read_text()
                for private_key in ['"scenario":', '"expected_container_tracking_fault":', '"_available_at":']:
                    self.assertNotIn(private_key, text)
            with self.assertRaises(ValueError):
                generate(a)


if __name__ == "__main__":
    unittest.main()
