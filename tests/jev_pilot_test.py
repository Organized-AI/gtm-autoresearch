import hashlib, json, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]; RUNNER=ROOT/"scripts/jev_pilot.py"
def canonical(v): return json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False)
def sha(v): return hashlib.sha256(v.encode()).hexdigest()
class PilotTest(unittest.TestCase):
 def package(self, directory):
  rubric={"status":"seed","rubricVersion":"r1"}; rh=sha(canonical(rubric)); inp={"observation":{"facts":{"n":1}}}; ci=canonical(inp)
  row={"recordId":"r1","inputHash":sha(ci),"canonicalInput":ci,"input":inp,"provenance":{"split":"train"},"deterministicReject":False,"rubricHash":rh}
  manifest={"schemaVersion":"jev-pilot-package-v1","rubricHash":rh,"pilotObservations":1,"maxAtomicEvaluations":2}
  files={"rubric.json":canonical(rubric)+"\n","pilot-inputs.jsonl":json.dumps(row)+"\n","manifest.json":json.dumps(manifest)+"\n"}
  for name,text in files.items():(directory/name).write_text(text)
  (directory/"checksums.json").write_text(json.dumps({name:sha(text) for name,text in files.items()}))
  return row,rh
 def invoke(self,*args): return subprocess.run([sys.executable,str(RUNNER),*args],text=True,capture_output=True)
 def test_preflight_and_external_score(self):
  with tempfile.TemporaryDirectory() as t:
   d=Path(t); row,rh=self.package(d); pre=self.invoke("preflight","--package",str(d)); self.assertEqual(pre.returncode,0,pre.stderr); self.assertEqual(json.loads(pre.stdout)["atomicEvaluationCap"],2)
   result=d/"results.jsonl"; result.write_text(json.dumps({"recordId":"r1","inputHash":row["inputHash"],"rubricHash":rh,"status":"success","answers":{"evidenceSufficient":"pass","trackingBehaviorPreserved":"insufficient"}})+"\n")
   scored=self.invoke("score","--package",str(d),"--results",str(result)); self.assertEqual(scored.returncode,0,scored.stderr); self.assertEqual(json.loads(scored.stdout)["predictionCount"],1)
 def test_rejects_tampered_input_and_missing_results(self):
  with tempfile.TemporaryDirectory() as t:
   d=Path(t); row,rh=self.package(d); row["canonicalInput"]="{}"; (d/"pilot-inputs.jsonl").write_text(json.dumps(row)+"\n");
   # Keep the checksum consistent so semantic validation, not checksum validation, rejects it.
   checks=json.loads((d/"checksums.json").read_text()); checks["pilot-inputs.jsonl"]=sha((d/"pilot-inputs.jsonl").read_text()); (d/"checksums.json").write_text(json.dumps(checks)); self.assertNotEqual(self.invoke("preflight","--package",str(d)).returncode,0)
  with tempfile.TemporaryDirectory() as t:
   d=Path(t); self.package(d); (d/"results.jsonl").write_text(""); self.assertNotEqual(self.invoke("score","--package",str(d),"--results",str(d/"results.jsonl")).returncode,0)
  with tempfile.TemporaryDirectory() as t:
   d=Path(t); row,rh=self.package(d); result={"recordId":"r1","inputHash":row["inputHash"],"rubricHash":rh,"status":"abstained","reason":"bounded"}; (d/"results.jsonl").write_text(json.dumps(result)+"\n"+json.dumps(result)+"\n"); self.assertNotEqual(self.invoke("score","--package",str(d),"--results",str(d/"results.jsonl")).returncode,0)
if __name__=="__main__": unittest.main()
