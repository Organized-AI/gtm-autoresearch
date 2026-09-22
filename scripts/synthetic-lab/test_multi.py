import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from generate import digest
from generate_multi import TOPOLOGIES, COMMON_SCENARIOS, build_case, generate, make_topology, visitor_actions, simulate, get_param


class MultiTopologyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = {p.key: {name: build_case(p, 20260921, 8, name)
                            for name, _ in list(COMMON_SCENARIOS) + [(p.extra_fault, "semantic_container_fault")]}
                     for p in TOPOLOGIES.values()}

    def settled(self, p, scenario, platform, event=None):
        reports = self.cases[p.key][scenario][-1]
        final = max(r["observed_at"] for r in reports)
        return next(e for r in reports if r["observed_at"] == final and r["event_window"] == "after" and r["platform"] == platform
                    for e in r["events"] if e["event_name"] == (event or p.conversion))

    def test_distinct_graphs_and_independent_populations(self):
        signatures, populations = set(), []
        for p in TOPOLOGIES.values():
            web, server = make_topology(p)
            signatures.add(tuple((len(c["containerVersion"]["tag"]), len(c["containerVersion"]["trigger"]), len(c["containerVersion"].get("client", []))) for c in (web, server)))
            populations.append({e["event_id"] for e in visitor_actions(p, 20260921, 8)})
        self.assertEqual(len(signatures), 3)
        for i in range(len(populations)):
            for j in range(i):
                self.assertFalse(populations[i] & populations[j])

    def test_healthy_tracks_eligible_conversions_with_real_source_differences(self):
        for p in TOPOLOGIES.values():
            before, after, events, network, _ = self.cases[p.key]["healthy"]
            self.assertEqual(before, after)
            eligible = [e for e in events if e["hour"] >= 24 and e["event_name"] == p.conversion and e["consent"]["ad_storage"] == "granted"]
            self.assertGreater(len(eligible), 0)
            for platform in ("meta", "google_ads"):
                summary = self.settled(p, "healthy", platform)
                self.assertEqual(summary["unique_events"], len(eligible), (p.key, platform))
                self.assertEqual(summary["attributed_conversions"], sum(e["channel"] == platform for e in eligible))
            meta = self.settled(p, "healthy", "meta")
            self.assertEqual(meta["browser_events"], 0 if p.key == "subscription" else len(eligible))
            source = "server" if p.key == "subscription" else "browser"
            self.assertEqual({n["source"] for n in network if n["platform"] == "google_ads"}, {source})

    def test_ingress_architecture_affects_delivery_not_just_names(self):
        for p in TOPOLOGIES.values():
            before = make_topology(p)
            after = copy.deepcopy(before)
            for tag in after[0]["containerVersion"]["tag"]:
                if tag["type"] == "gaawe":
                    tag["firingTriggerId"] = []
            _, requests = simulate(p, visitor_actions(p, 77, 8), (before, after), "healthy")
            srv = [n for n in requests if n["source"] == "server" and n["occurred_at"] >= "2026-01-02T00:00:00Z"]
            if p.key == "leadgen":
                self.assertEqual(srv, [])
            elif p.key == "subscription":
                self.assertGreater(len(srv), 0)
                self.assertEqual({n["event_name"] for n in srv}, {p.conversion})
            else:
                self.assertEqual({n["event_name"] for n in srv}, set(p.events))

    def test_only_missing_reference_is_structurally_invalid(self):
        for p in TOPOLOGIES.values():
            for scenario, case in self.cases[p.key].items():
                bad = []
                for container in case[1]:
                    cv = container["containerVersion"]
                    ids = {t["triggerId"] for t in cv["trigger"]}
                    self.assertEqual(len(ids), len(cv["trigger"]))
                    self.assertEqual(len({t["tagId"] for t in cv["tag"]}), len(cv["tag"]))
                    bad += [tid for tag in cv["tag"] for tid in tag.get("firingTriggerId", []) + tag.get("blockingTriggerId", []) if tid not in ids]
                self.assertEqual(bool(bad), scenario == "broken_trigger_reference", (p.key, scenario))

    def test_rename_and_noncontainer_changes_preserve_config(self):
        for p in TOPOLOGIES.values():
            good = self.cases[p.key]["healthy"]
            renamed = self.cases[p.key]["benign_rename"]
            self.assertEqual(good[2], renamed[2]); self.assertEqual(good[4], renamed[4])
            for scenario in ("healthy", "business_conversion_drop", "traffic_mix_shift", "reporting_delay", "server_outage"):
                case = self.cases[p.key][scenario]
                self.assertEqual(case[0], case[1], (p.key, scenario))

    def test_common_faults_have_their_claimed_effects(self):
        for p in TOPOLOGIES.values():
            for scenario in ("google_label_mismatch", "conversion_trigger_mismatch"):
                self.assertEqual(self.settled(p, scenario, "google_ads")["unique_events"], 0)
            paired = p.events[-2] if p.key == "subscription" else p.conversion
            good = self.settled(p, "healthy", "meta", paired)
            mismatch = self.settled(p, "meta_event_id_mismatch", "meta", paired)
            self.assertEqual(mismatch["unique_events"], good["unique_events"] * 2)
            self.assertEqual(mismatch["server_dedup_overlap_rate"], 0)
            missing = self.settled(p, "match_data_missing", "meta", paired)
            self.assertEqual(missing["unique_events"], good["unique_events"])
            self.assertLess(missing["simulated_emq_proxy"], good["simulated_emq_proxy"])
            self.assertEqual(self.settled(p, "server_outage", "meta")["server_events"], 0)
            for scenario, case in self.cases[p.key].items():
                leaks = [n for n in case[3] if n["platform"] != "ga4" and n["consent"]["ad_storage"] == "denied"]
                self.assertEqual(bool(leaks), scenario == "consent_bypass", (p.key, scenario))

    def test_business_traffic_and_reporting_controls(self):
        for p in TOPOLOGIES.values():
            self.assertLess(self.settled(p, "business_conversion_drop", "meta")["unique_events"], self.settled(p, "healthy", "meta")["unique_events"])
            for platform in ("meta", "google_ads"):
                shifted, good = self.settled(p, "traffic_mix_shift", platform), self.settled(p, "healthy", platform)
                self.assertEqual(shifted["unique_events"], good["unique_events"])
                self.assertEqual(shifted["attributed_conversions"], 0)
            self.assertEqual(self.settled(p, "reporting_delay", "google_ads"), self.settled(p, "healthy", "google_ads"))
            def at48(scenario):
                return next(r["events"][0]["unique_events"] for r in self.cases[p.key][scenario][-1] if r["observed_at"] == "2026-01-03T00:00:00Z" and r["platform"] == "google_ads" and r["event_window"] == "after")
            self.assertLess(at48("reporting_delay"), at48("healthy"))

    def test_architecture_specific_faults(self):
        p = TOPOLOGIES["retail"]
        missing = self.settled(p, p.extra_fault, "meta", "begin_checkout")
        self.assertEqual(missing["browser_events"], 0)
        self.assertGreater(missing["server_events"], 0)
        self.assertEqual(self.settled(p, p.extra_fault, "google_ads"), self.settled(p, "healthy", "google_ads"))
        p = TOPOLOGIES["leadgen"]
        self.assertEqual(self.settled(p, p.extra_fault, "meta")["server_events"], 0)
        self.assertGreater(self.settled(p, p.extra_fault, "meta")["browser_events"], 0)
        p = TOPOLOGIES["subscription"]
        def ga4(scenario):
            return [n for n in self.cases[p.key][scenario][3] if n["platform"] == "ga4" and n["event_name"] == p.conversion and n["occurred_at"] >= "2026-01-02T00:00:00Z"]
        good, bad = ga4("healthy"), ga4(p.extra_fault)
        self.assertGreater(len(bad), len(good))
        self.assertEqual(len({n["logical_event_id"] for n in bad}), len(good))
        self.assertEqual(len({n["request_id"] for n in bad}), len(bad))
        self.assertEqual(self.settled(p, p.extra_fault, "google_ads"), self.settled(p, "healthy", "google_ads"))

    def test_cases_paired_before_drift(self):
        for p in TOPOLOGIES.values():
            def early(case):
                return [n for n in case[3] if n["occurred_at"] < "2026-01-02T00:00:00Z"]
            for case in self.cases[p.key].values():
                self.assertEqual(early(case), early(self.cases[p.key]["healthy"]))

    def test_manifest_stable_topology_isolation_hashes_and_oracle_separation(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = Path(tmp) / "a", Path(tmp) / "b"
            manifest = generate(a, (77, 78), 2)
            generate(b, (77, 78), 2)
            self.assertEqual((a / "checksums.json").read_bytes(), (b / "checksums.json").read_bytes())
            self.assertEqual(len(manifest["cases"]), 78)
            self.assertEqual(len({c["lineage_group"] for c in manifest["cases"]}), 6)
            self.assertEqual(len({c["container_group"] for c in manifest["cases"]}), 3)
            for group in {c["topology_group"] for c in manifest["cases"]}:
                rows = [c for c in manifest["cases"] if c["topology_group"] == group]
                self.assertEqual(len({c["split"] for c in rows}), 1)
                self.assertEqual(len({c["lineage_group"] for c in rows}), 2)
            for rel, expected in json.loads((a / "checksums.json").read_text()).items():
                raw = (a / rel).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), expected)
                if rel.startswith("observations/"):
                    for key in ('"scenario":', '"expected_container_tracking_fault":', '"_available_at":', '"split":'):
                        self.assertNotIn(key, raw.decode())
            with self.assertRaises(ValueError): generate(a)
            with self.assertRaises(ValueError): generate(Path(tmp) / "bad", (77, 77))


if __name__ == "__main__":
    unittest.main()
