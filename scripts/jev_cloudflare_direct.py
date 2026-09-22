#!/usr/bin/env python3
"""Direct, no-retry Cloudflare Workers AI transport for one frozen Jev choice."""
from __future__ import annotations
import json, os, re, sys, time, urllib.error, urllib.request
from typing import Any, Mapping

MAX_RESPONSE_BYTES = 256_000
MAX_SAFE_INTEGER = 9_007_199_254_740_991
ACCOUNT_ID = re.compile(r"[0-9a-f]{32}")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any):
        raise urllib.error.HTTPError(args[0], 302, "redirects are disabled", args[3] if len(args)>3 else {}, None)

def fail(message: str) -> None: raise ValueError(message)
def finite(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int,float)) or value != value or value in (float('inf'), float('-inf')): fail("invalid numeric response field")
    return float(value)
def response_headers(headers: Any) -> dict[str, str]:
    items = headers.items() if hasattr(headers, "items") else []
    return {str(key).lower(): str(value) for key, value in items}
def unwrap(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict): fail("Cloudflare response is not an object")
    if "success" in body:
        if body.get("success") is not True:
            errors = body.get("errors")
            code = errors[0].get("code") if isinstance(errors,list) and errors and isinstance(errors[0],dict) else "unknown"
            fail(f"Cloudflare API error {code}")
        result = body.get("result")
        if not isinstance(result, dict): fail("Cloudflare success response result missing")
        return result
    if isinstance(body.get("result"), dict): return body["result"]
    return body

def evaluate(request: Mapping[str, Any]) -> dict[str, Any]:
    account, token, model = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN"), request.get("model")
    if not account or not token: fail("missing Cloudflare credentials")
    if not ACCOUNT_ID.fullmatch(account): fail("invalid Cloudflare account identifier")
    if model != "typesafe/jev": fail("direct transport requires model typesafe/jev")
    observation, question = request.get("observation"), request.get("question")
    if not isinstance(observation, dict) or not isinstance(question, dict): fail("invalid direct Jev request")
    name, instructions, criteria = question.get("name"), question.get("instructions"), question.get("criteria")
    if not isinstance(name,str) or not isinstance(instructions,str) or not isinstance(criteria,dict) or not criteria: fail("invalid frozen choice question")
    payload={"model":model,"input":{"state":{"observation":observation},"questions":{name:{"type":"choice","instructions":instructions,"criteria":criteria}}}}
    encoded=json.dumps(payload,separators=(",",":"),ensure_ascii=False).encode()
    req=urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run",data=encoded,headers={"Authorization":f"Bearer {token}","Content-Type":"application/json","Accept":"application/json"},method="POST")
    started=time.monotonic()
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=55) as response:
            raw=response.read(MAX_RESPONSE_BYTES+1); headers=response_headers(response.headers)
    except urllib.error.HTTPError as error:
        raise ValueError(f"Cloudflare HTTP {error.code}") from error
    except urllib.error.URLError as error:
        raise ValueError("Cloudflare transport error") from error
    latency_ms=round((time.monotonic()-started)*1000,3)
    if len(raw)>MAX_RESPONSE_BYTES: fail("Cloudflare response exceeds limit")
    try: body=unwrap(json.loads(raw))
    except json.JSONDecodeError as error: raise ValueError("Cloudflare response is not JSON") from error
    if not isinstance(body.get("model"),str) or not body["model"]: fail("Cloudflare response model missing")
    answer=body.get("answers",{}).get(name) if isinstance(body.get("answers"),dict) else None
    if not isinstance(answer,dict) or set(answer)!={"type","choice","confidence","probabilities"} or answer.get("type")!="choice" or answer.get("choice") not in criteria: fail("Cloudflare choice response is invalid")
    confidence=finite(answer["confidence"]); probabilities=answer["probabilities"]
    if not 0<=confidence<=1 or not isinstance(probabilities,dict) or set(probabilities)!=set(criteria) or any(not 0<=finite(value)<=1 for value in probabilities.values()): fail("Cloudflare confidence/probabilities are invalid")
    usage=body.get("usage")
    if not isinstance(usage,dict) or set(usage)!={"input_tokens","output_tokens"} or any(isinstance(usage[key],bool) or not isinstance(usage[key],int) or not 0<=usage[key]<=MAX_SAFE_INTEGER for key in usage): fail("Cloudflare usage is invalid")
    metadata={"reportedModel":body["model"],"latencyMs":latency_ms,"requestId":headers.get("x-request-id") or headers.get("cf-ray"),"confidence":confidence,"probabilities":probabilities,"usage":{"input_tokens":usage["input_tokens"],"output_tokens":usage["output_tokens"]}}
    return {"choice":answer["choice"],"metadata":metadata}

def safe_reason(error: Exception) -> str:
    text = str(error)
    if text.startswith("Cloudflare HTTP "): return "Cloudflare HTTP error"
    if text.startswith("Cloudflare API error "): return "Cloudflare API error"
    allowed = {"missing Cloudflare credentials", "invalid Cloudflare account identifier", "direct transport requires model typesafe/jev", "invalid direct Jev request", "invalid frozen choice question", "Cloudflare transport error", "Cloudflare response exceeds limit", "Cloudflare response is not JSON", "Cloudflare response is not an object", "Cloudflare success response result missing", "Cloudflare response model missing", "Cloudflare choice response is invalid", "Cloudflare confidence/probabilities are invalid", "Cloudflare usage is invalid", "invalid numeric response field"}
    return text if text in allowed else "direct Cloudflare evaluation failed"

def main() -> None:
    try: print(json.dumps(evaluate(json.load(sys.stdin)),separators=(",",":")))
    except Exception as error:
        print(json.dumps({"error":type(error).__name__,"reason":safe_reason(error)},separators=(",",":"))); raise SystemExit(2)
if __name__=="__main__": main()
