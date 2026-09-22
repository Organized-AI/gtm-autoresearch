#!/usr/bin/env python3
"""JSON-lines-free Jev AIFunction worker. stdout is protocol only; stderr diagnostics."""
import hashlib, json, sys

def stable(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
def sha(value): return hashlib.sha256(stable(value).encode()).hexdigest()
def unavailable(reason, evidence=None): return {"status":"unavailable","reason":reason,"evidenceHash":evidence.get("evidenceHash") if evidence else None}
def main():
  try:
    request=json.load(sys.stdin); evidence=request["evidence"]
    if request.get("protocol") != "jev-shadow-v1": return {"status":"error","reason":"unsupported protocol"}
    definition_path=request.get("definitionPath")
    if not definition_path: return unavailable("definition path missing", evidence)
    # Live provider execution is intentionally disabled unless a reviewed definition and
    # credentials are installed. AIFunction.load keeps saved preprocessing semantics.
    try:
      from jev_align import AIFunction  # isolated optional dependency
      function=AIFunction.load(definition_path)
    except ImportError: return unavailable("jev_align is not installed", evidence)
    except Exception as exc: return unavailable("definition load failed: " + type(exc).__name__, evidence)
    prediction=function(**evidence)
    values=getattr(prediction,"values",prediction)
    if not isinstance(values,dict): return {"status":"error","reason":"unsupported Prediction payload"}
    return {"status":"success","evidenceHash":evidence["evidenceHash"],"definitionHash":evidence["frozen"]["contentHash"],"requestedModel":evidence["frozen"]["requestedModel"],"reportedModel":values.get("model"),"answers":{"evidenceSufficient":values.get("evidenceSufficient"),"purchaseBehaviorPreserved":values.get("purchaseBehaviorPreserved")},"uncertainty":values.get("uncertainty")}
  except Exception as exc: return {"status":"error","reason":"worker protocol error: " + type(exc).__name__}
if __name__ == "__main__": json.dump(main(),sys.stdout,separators=(",",":"))
