import importlib.util, io, json, os, unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("cloudflare_direct",ROOT/"scripts/jev_cloudflare_direct.py")
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
class Response:
 def __init__(self,body): self.body=body; self.headers={"cf-ray":"ray-test"}
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
  with patch.dict(os.environ,{"CLOUDFLARE_ACCOUNT_ID":"account","CLOUDFLARE_API_TOKEN":"secret"},clear=True),patch.object(module.urllib.request,"build_opener",return_value=opener): result=module.evaluate(self.request())
  self.assertEqual(result["choice"],"pass");self.assertEqual(result["metadata"]["usage"],{"input_tokens":12,"output_tokens":3});self.assertEqual(result["metadata"]["requestId"],"ray-test")
  self.assertEqual(len(opener.requests),1); payload=json.loads(opener.requests[0][0].data);self.assertEqual(payload["model"],"typesafe/jev");self.assertEqual(payload["input"]["state"],{"observation":{"synthetic":True}});self.assertNotIn("labels",json.dumps(payload))
 def test_rejects_malformed_or_mismatched_choices_without_retry(self):
  body=json.dumps({"model":"jev","answers":{"evidenceSufficient":{"type":"choice","choice":"wrong","confidence":1,"probabilities":{}}}}).encode(); opener=Opener(Response(body))
  with patch.dict(os.environ,{"CLOUDFLARE_ACCOUNT_ID":"account","CLOUDFLARE_API_TOKEN":"secret"},clear=True),patch.object(module.urllib.request,"build_opener",return_value=opener):
   with self.assertRaises(ValueError): module.evaluate(self.request())
  self.assertEqual(len(opener.requests),1)
if __name__=="__main__": unittest.main()
