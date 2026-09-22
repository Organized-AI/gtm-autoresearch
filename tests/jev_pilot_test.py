import hashlib, json, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]; RUNNER=ROOT/"scripts/jev_pilot.py"
def canonical(v): return json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False)
def sha(v): return hashlib.sha256(v.encode()).hexdigest()
class PilotTest(unittest.TestCase):
 def package(self, directory):
  labels={"pass":"p","fail":"f","insufficient":"i"}; rubric={"status":"seed","rubricVersion":"r1","preprocessingVersion":"synthetic-gtm-observation-v2","functions":{"evidenceSufficient":{"description":"d","labels":labels},"trackingBehaviorPreserved":{"description":"d","labels":labels}}}; rh=sha(canonical(rubric)); inp={"observation":{"schemaVersion":"synthetic-gtm-observation-v2","decisionTime":"2026-01-01T00:00:00.000Z","synthetic":True,"facts":{"n":1},"cautions":[]}}; ci=canonical(inp)
  row={"recordId":"r1","inputHash":sha(ci),"canonicalInput":ci,"input":inp,"provenance":{"split":"train","decisionTime":"2026-01-01T00:00:00.000Z"},"deterministicReject":False,"rubricHash":rh}
  manifest={"schemaVersion":"jev-pilot-package-v1","rubricHash":rh,"pilotObservations":1,"maxAtomicEvaluations":2}
  expected={"recordId":"r1","inputHash":row["inputHash"],"rubricHash":rh,"reviewStatus":"unreviewed","provenance":"synthetic_generator_rule_not_human_reviewed","labelVersion":"synthetic-observability-labels-v1","deterministicReject":False,"expectedAnswers":{"evidenceSufficient":"pass","trackingBehaviorPreserved":"fail"}}
  files={"rubric.json":canonical(rubric)+"\n","pilot-inputs.jsonl":json.dumps(row)+"\n","pilot-expected.jsonl":json.dumps(expected)+"\n","manifest.json":json.dumps(manifest)+"\n"}
  for name,text in files.items():(directory/name).write_text(text)
  (directory/"checksums.json").write_text(json.dumps({name:sha(text) for name,text in files.items()}))
  return row,rh
 def invoke(self,*args): return subprocess.run([sys.executable,str(RUNNER),*args],text=True,capture_output=True)
 def test_preflight_and_external_score(self):
  with tempfile.TemporaryDirectory() as t:
   d=Path(t); row,rh=self.package(d); pre=self.invoke("preflight","--package",str(d)); self.assertEqual(pre.returncode,0,pre.stderr); self.assertEqual(json.loads(pre.stdout)["atomicEvaluationCap"],2)
   result=d/"results.jsonl"; result.write_text(json.dumps({"recordId":"r1","inputHash":row["inputHash"],"rubricHash":rh,"status":"success","answers":{"evidenceSufficient":"pass","trackingBehaviorPreserved":"insufficient"}})+"\n")
   scored=self.invoke("score","--package",str(d),"--results",str(result)); self.assertEqual(scored.returncode,0,scored.stderr); self.assertEqual(json.loads(scored.stdout)["predictionCount"],1); self.assertEqual(json.loads(scored.stdout)["agreementWithUnreviewedGeneratorLabels"]["evidenceSufficient"]["matches"],1)
 def test_rejects_tampered_input_and_missing_results(self):
  with tempfile.TemporaryDirectory() as t:
   d=Path(t); row,rh=self.package(d); row["canonicalInput"]="{}"; (d/"pilot-inputs.jsonl").write_text(json.dumps(row)+"\n");
   # Keep the checksum consistent so semantic validation, not checksum validation, rejects it.
   checks=json.loads((d/"checksums.json").read_text()); checks["pilot-inputs.jsonl"]=sha((d/"pilot-inputs.jsonl").read_text()); (d/"checksums.json").write_text(json.dumps(checks)); self.assertNotEqual(self.invoke("preflight","--package",str(d)).returncode,0)
  with tempfile.TemporaryDirectory() as t:
   d=Path(t); self.package(d); (d/"results.jsonl").write_text(""); self.assertNotEqual(self.invoke("score","--package",str(d),"--results",str(d/"results.jsonl")).returncode,0)
  with tempfile.TemporaryDirectory() as t:
   d=Path(t); row,rh=self.package(d); result={"recordId":"r1","inputHash":row["inputHash"],"rubricHash":rh,"status":"abstained","reason":"bounded"}; (d/"results.jsonl").write_text(json.dumps(result)+"\n"+json.dumps(result)+"\n"); self.assertNotEqual(self.invoke("score","--package",str(d),"--results",str(d/"results.jsonl")).returncode,0)
 def test_preserves_javascript_numeric_canonical_bytes(self):
  with tempfile.TemporaryDirectory() as t:
   d=Path(t); row,_=self.package(d); row["input"]["observation"]["facts"]={"tiny":1e-7}; row["canonicalInput"]='{"observation":{"cautions":[],"decisionTime":"2026-01-01T00:00:00.000Z","facts":{"tiny":1e-7},"schemaVersion":"synthetic-gtm-observation-v2","synthetic":true}}'; row["inputHash"]=sha(row["canonicalInput"]); (d/"pilot-inputs.jsonl").write_text(json.dumps(row)+"\n"); checks=json.loads((d/"checksums.json").read_text()); checks["pilot-inputs.jsonl"]=sha((d/"pilot-inputs.jsonl").read_text()); (d/"checksums.json").write_text(json.dumps(checks)); self.assertEqual(self.invoke("preflight","--package",str(d)).returncode,0)
 def test_rejects_boolean_type_mismatch_and_bad_expected_or_answers(self):
  with tempfile.TemporaryDirectory() as t:
   d=Path(t); row,rh=self.package(d); row["input"]["observation"]["facts"]={"n":True}; (d/"pilot-inputs.jsonl").write_text(json.dumps(row)+"\n"); checks=json.loads((d/"checksums.json").read_text()); checks["pilot-inputs.jsonl"]=sha((d/"pilot-inputs.jsonl").read_text()); (d/"checksums.json").write_text(json.dumps(checks)); self.assertNotEqual(self.invoke("preflight","--package",str(d)).returncode,0)
  with tempfile.TemporaryDirectory() as t:
   d=Path(t); row,rh=self.package(d); expected=(d/"pilot-expected.jsonl").read_text(); (d/"pilot-expected.jsonl").write_text(expected+expected); checks=json.loads((d/"checksums.json").read_text()); checks["pilot-expected.jsonl"]=sha((d/"pilot-expected.jsonl").read_text()); (d/"checksums.json").write_text(json.dumps(checks)); bad={"recordId":"r1","inputHash":row["inputHash"],"rubricHash":rh,"status":"success","answers":{"evidenceSufficient":"wat","trackingBehaviorPreserved":"pass"}}; (d/"results.jsonl").write_text(json.dumps(bad)+"\n"); self.assertNotEqual(self.invoke("score","--package",str(d),"--results",str(d/"results.jsonl")).returncode,0)
if __name__=="__main__": unittest.main()
