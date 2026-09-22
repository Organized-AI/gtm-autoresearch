#!/usr/bin/env python3
"""JSON protocol for two frozen atomic jev_align AIFunction shadow calls."""
import contextlib, hashlib, json, math, sys

def stable(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
def digest(value): return hashlib.sha256(stable(value).encode()).hexdigest()
def unavailable(reason): return {"status":"unavailable","reason":reason}
def prediction_result(prediction):
  choice=getattr(prediction,"choice",None); confidence=getattr(prediction,"confidence",None)
  if choice not in ("pass","fail","insufficient"): raise ValueError("Prediction.choice is not an atomic label")
  if isinstance(confidence,bool) or not isinstance(confidence,(int,float)) or not math.isfinite(confidence) or not 0 <= confidence <= 1: raise ValueError("Prediction.confidence missing or invalid")
  return choice, 1-confidence, getattr(prediction,"resolved_model",None)
def loaded_definition(function):
  definition=getattr(function,"_definition",None)
  state=getattr(function,"_state",None); backend=getattr(function,"_backend",None)
  if not isinstance(definition,dict) or state is None or backend is None: raise ValueError("unsupported AIFunction runtime layout")
  return definition
def main():
  try:
    request=json.load(sys.stdin); evidence=request["evidence"]
    if request.get("protocol") != "jev-shadow-v1": return {"status":"error","reason":"unsupported protocol"}
    manifest_path=request.get("definitionPath")
    if not manifest_path: return unavailable("frozen manifest path missing")
    try:
      with open(manifest_path,encoding="utf-8") as handle: manifest=json.load(handle)
    except OSError: return unavailable("frozen manifest missing")
    frozen=evidence["frozen"]
    payload=dict(manifest); declared_hash=payload.pop("manifestHash",None)
    if not isinstance(declared_hash,str) or digest(payload) != declared_hash or declared_hash != frozen.get("contentHash") or manifest.get("requestedModel") != frozen.get("requestedModel") or manifest.get("preprocessingVersion") != frozen.get("preprocessingVersion") or manifest.get("policyVersion") != frozen.get("policyVersion"):
      return {"status":"error","reason":"frozen manifest identity mismatch"}
    functions=manifest.get("functions",{})
    if set(functions) != {"evidenceSufficient","trackingBehaviorPreserved"}: return {"status":"error","reason":"manifest must contain two atomic functions"}
    loaded={}
    try:
      from jev_align import AIFunction
      with contextlib.redirect_stdout(sys.stderr):
        for name,spec in functions.items(): loaded[name]=AIFunction.load(spec["path"])
        # Validate the entire frozen pair before any function can call a provider.
        for name,function in loaded.items():
          spec=functions[name]; definition=loaded_definition(function); backend=definition.get("backend",{})
          if digest(definition) != spec.get("definitionHash") or backend.get("provider") != spec.get("provider") or backend.get("model") != spec.get("model"):
            return {"status":"error","reason":"loaded function identity mismatch"}
        answers={}; uncertainties=[]; resolved=[]
        for name,function in loaded.items():
          choice,uncertainty,resolved_model=prediction_result(function(**evidence)); answers[name]=choice; uncertainties.append(uncertainty)
          if isinstance(resolved_model,str): resolved.append(resolved_model)
    except ImportError: return unavailable("jev_align is not installed")
    except Exception as exc: return {"status":"error","reason":"worker evaluation failed: "+type(exc).__name__}
    finally:
      with contextlib.redirect_stdout(sys.stderr):
        for function in loaded.values():
          close=getattr(function,"close",None)
          if callable(close):
            try: close()
            except Exception: pass
    # Both atomic functions supplied valid confidence, so max uncertainty is conservative.
    result={"status":"success","evidenceHash":evidence["evidenceHash"],"definitionHash":frozen["contentHash"],"requestedModel":frozen["requestedModel"],"answers":answers,"uncertainty":max(uncertainties)}
    if resolved: result["reportedModel"]=";".join(sorted(set(resolved)))
    return result
  except Exception as exc: return {"status":"error","reason":"worker protocol error: "+type(exc).__name__}
if __name__ == "__main__": json.dump(main(),sys.stdout,separators=(",",":"))
