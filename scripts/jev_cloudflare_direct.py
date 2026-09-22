#!/usr/bin/env python3
"""Direct, no-retry Cloudflare Workers AI transport for one frozen Jev choice."""
from __future__ import annotations
import json, os, sys, time, urllib.error, urllib.request
from dataclasses import dataclass
from typing import Any, Mapping

MAX_RESPONSE_BYTES = 256_000

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any):
        raise urllib.error.HTTPError(args[0], 302, "redirects are disabled", args[3] if len(args)>3 else {}, None)

def fail(message: str) -> None: raise ValueError(message)
def finite(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int,float)) or value != value or value in (float('inf'), float('-inf')): fail("invalid numeric response field")
    return float(value)

def evaluate(request: Mapping[str, Any]) -> dict[str, Any]:
    account, token, model = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN"), request.get("model")
    if not account or not token: fail("missing Cloudflare credentials")
    observation, question = request.get("observation"), request.get("question")
    if not isinstance(observation, dict) or not isinstance(question, dict) or not isinstance(model, str) or not model: fail("invalid direct Jev request")
    name, instructions, criteria = question.get("name"), question.get("instructions"), question.get("criteria")
    if not isinstance(name,str) or not isinstance(instructions,str) or not isinstance(criteria,dict) or not criteria: fail("invalid frozen choice question")
    payload={"model":model,"input":{"state":{"observation":observation},"questions":{name:{"type":"choice","instructions":instructions,"criteria":criteria}}}}
    encoded=json.dumps(payload,separators=(",",":"),ensure_ascii=False).encode()
    req=urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run",data=encoded,headers={"Authorization":f"Bearer {token}","Content-Type":"application/json","Accept":"application/json"},method="POST")
    started=time.monotonic()
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=55) as response:
            raw=response.read(MAX_RESPONSE_BYTES+1)
            headers=dict(response.headers.items())
    except urllib.error.HTTPError as error:
        raise ValueError(f"Cloudflare HTTP {error.code}") from error
    except urllib.error.URLError as error:
        raise ValueError("Cloudflare transport error") from error
    latency_ms=round((time.monotonic()-started)*1000,3)
    if len(raw)>MAX_RESPONSE_BYTES: fail("Cloudflare response exceeds limit")
    try: body=json.loads(raw)
    except json.JSONDecodeError as error: raise ValueError("Cloudflare response is not JSON") from error
    if not isinstance(body,dict) or not isinstance(body.get("model"),str): fail("Cloudflare response model missing")
    answer=body.get("answers",{}).get(name) if isinstance(body.get("answers"),dict) else None
    if not isinstance(answer,dict) or answer.get("type")!="choice" or answer.get("choice") not in criteria: fail("Cloudflare choice response is invalid")
    confidence=finite(answer.get("confidence"))
    probabilities=answer.get("probabilities")
    if not 0<=confidence<=1 or not isinstance(probabilities,dict) or set(probabilities)!=set(criteria): fail("Cloudflare confidence/probabilities are invalid")
    if any(finite(value)<0 for value in probabilities.values()): fail("Cloudflare probabilities are invalid")
    usage=body.get("usage")
    if not isinstance(usage,dict) or not {"input_tokens","output_tokens"} <= set(usage) or any(isinstance(usage[key],bool) or not isinstance(usage[key],int) or usage[key] < 0 for key in usage):
        fail("Cloudflare usage is invalid")
    metadata={"reportedModel":body["model"],"latencyMs":latency_ms,"requestId":headers.get("x-request-id") or headers.get("cf-ray"),"confidence":confidence,"probabilities":probabilities,"usage":{"input_tokens":usage["input_tokens"],"output_tokens":usage["output_tokens"]}}
    return {"choice":answer["choice"],"metadata":metadata}

def main() -> None:
    try:
        request=json.load(sys.stdin); print(json.dumps(evaluate(request),separators=(",",":")))
    except Exception as error:
        print(json.dumps({"error":type(error).__name__}),file=sys.stdout); raise SystemExit(2)
if __name__=="__main__": main()
