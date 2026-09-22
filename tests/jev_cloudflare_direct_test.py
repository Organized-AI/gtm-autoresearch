import importlib.util, io, json, os, unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("cloudflare_direct",ROOT/"scripts/jev_cloudflare_direct.py")
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
class Response:
 def __init__(self,body): self.body=body; self.headers={"CF-Ray":"ray-test"}
 def read(self,n): return self.body
 def __enter__(self): return self
 def __exit__(self,*args): return False
class Opener:
 def __init__(self,response): self.response=response; self.requests=[]
 def open(self,request,timeout): self.requests.append((request,timeout)); return self.response
class DirectCloudflareTest(unittest.TestCase):
 def request(self): return {"model":"typesafe/jev","observation":{"synthetic":True},"question":{"name":"evidenceSufficient","instructions":"fixed","criteria":{"pass":"p","fail":"f","insufficient":"i"}}}
 def test_posts_one_observation_only_and_captures_actual_metadata(self):
  body=json.dumps({"model":"jev-1.13.0","answers":{"evidenceSufficient":{"type":"choice","choice":"pass","confidence":.8,"probabilities":{"pass":.8,"fail":.1,"insufficient":.1}}},"usage":{"input_tokens":12,"output_tokens":3}}).encode(); opener=Opener(Response(body))
  with patch.dict(os.environ,{"CLOUDFLARE_ACCOUNT_ID":"a"*32,"CLOUDFLARE_API_TOKEN":"secret"},clear=True),patch.object(module.urllib.request,"build_opener",return_value=opener): result=module.evaluate(self.request())
  self.assertEqual(result["choice"],"pass");self.assertEqual(result["metadata"]["usage"],{"input_tokens":12,"output_tokens":3});self.assertEqual(result["metadata"]["requestId"],"ray-test")
  self.assertEqual(len(opener.requests),1); payload=json.loads(opener.requests[0][0].data);self.assertEqual(payload["model"],"typesafe/jev");self.assertEqual(payload["input"]["state"],{"observation":{"synthetic":True}});self.assertNotIn("labels",json.dumps(payload))
 def test_accepts_success_result_envelope_and_rejects_api_errors_and_usage_bounds(self):
  answer={"type":"choice","choice":"pass","confidence":1,"probabilities":{"pass":1,"fail":0,"insufficient":0}}
  good=json.dumps({"success":True,"result":{"model":"jev-1.13.0","answers":{"evidenceSufficient":answer},"usage":{"input_tokens":9007199254740991,"output_tokens":0}}}).encode(); opener=Opener(Response(good))
  with patch.dict(os.environ,{"CLOUDFLARE_ACCOUNT_ID":"a"*32,"CLOUDFLARE_API_TOKEN":"secret"},clear=True),patch.object(module.urllib.request,"build_opener",return_value=opener): self.assertEqual(module.evaluate(self.request())["choice"],"pass")
  bad=json.dumps({"success":False,"errors":[{"code":1000,"message":"untrusted response text"}]}).encode(); opener=Opener(Response(bad))
  with patch.dict(os.environ,{"CLOUDFLARE_ACCOUNT_ID":"a"*32,"CLOUDFLARE_API_TOKEN":"secret"},clear=True),patch.object(module.urllib.request,"build_opener",return_value=opener):
   with self.assertRaisesRegex(ValueError,"API error 1000"): module.evaluate(self.request())
  overflow=json.dumps({"model":"jev","answers":{"evidenceSufficient":answer},"usage":{"input_tokens":9007199254740992,"output_tokens":0}}).encode(); opener=Opener(Response(overflow))
  with patch.dict(os.environ,{"CLOUDFLARE_ACCOUNT_ID":"a"*32,"CLOUDFLARE_API_TOKEN":"secret"},clear=True),patch.object(module.urllib.request,"build_opener",return_value=opener):
   with self.assertRaisesRegex(ValueError,"usage"): module.evaluate(self.request())

 def test_rejects_malformed_or_mismatched_choices_without_retry(self):
  body=json.dumps({"model":"jev","answers":{"evidenceSufficient":{"type":"choice","choice":"wrong","confidence":1,"probabilities":{}}}}).encode(); opener=Opener(Response(body))
  with patch.dict(os.environ,{"CLOUDFLARE_ACCOUNT_ID":"a"*32,"CLOUDFLARE_API_TOKEN":"secret"},clear=True),patch.object(module.urllib.request,"build_opener",return_value=opener):
   with self.assertRaises(ValueError): module.evaluate(self.request())
  self.assertEqual(len(opener.requests),1)
if __name__=="__main__": unittest.main()
