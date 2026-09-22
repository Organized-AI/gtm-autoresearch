#!/usr/bin/env python3
"""JSON protocol for two frozen, atomic jev_align AIFunction shadow calls."""
import hashlib, json, sys

def stable(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
def digest(value): return hashlib.sha256(stable(value).encode()).hexdigest()
def unavailable(reason): return {"status":"unavailable","reason":reason}
def choice_and_uncertainty(prediction):
  choice=getattr(prediction,"choice",None)
  if choice not in ("pass","fail","insufficient"): raise ValueError("Prediction.choice is not an atomic label")
  probabilities=getattr(prediction,"label_probabilities",None); confidence=None
  if isinstance(probabilities,dict):
    candidate=probabilities.get(choice)
    if isinstance(candidate,(int,float)) and 0 <= candidate <= 1: confidence=candidate
  return choice, None if confidence is None else 1-confidence
def function_identity(function):
  return digest({"current_candidate":getattr(function,"current_candidate",None),"backend":getattr(function,"backend",None),"selected_columns":getattr(function,"selected_columns",None),"column_mode":getattr(function,"column_mode",None)})
def actual_model(function):
  candidate=getattr(function,"current_candidate",None)
  return candidate.get("model") if isinstance(candidate,dict) and isinstance(candidate.get("model"),str) else None
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
    for key in ("definitionHash","requestedModel","preprocessingVersion"):
      if manifest.get(key) != frozen.get({"definitionHash":"contentHash"}.get(key,key)):
        return {"status":"error","reason":"frozen manifest identity mismatch"}
    functions=manifest.get("functions",{})
    if set(functions) != {"evidenceSufficient","trackingBehaviorPreserved"}: return {"status":"error","reason":"manifest must contain two atomic functions"}
    try:
      from jev_align import AIFunction
      loaded={name:AIFunction.load(spec["path"]) for name,spec in functions.items()}
      for name,function in loaded.items():
        if function_identity(function) != functions[name].get("loadedIdentityHash"): return {"status":"error","reason":"loaded function identity mismatch"}
      answers={}; uncertainties=[]; models=[]
      for name,function in loaded.items():
        choice,uncertainty=choice_and_uncertainty(function(**evidence)); answers[name]=choice
        if uncertainty is not None: uncertainties.append(uncertainty)
        model=actual_model(function)
        if model: models.append(model)
    except ImportError: return unavailable("jev_align is not installed")
    except Exception as exc: return {"status":"error","reason":"worker evaluation failed: "+type(exc).__name__}
    result={"status":"success","evidenceHash":evidence["evidenceHash"],"definitionHash":frozen["contentHash"],"requestedModel":frozen["requestedModel"],"answers":answers}
    if models: result["reportedModel"]=";".join(sorted(set(models)))
    if uncertainties: result["uncertainty"]=max(uncertainties)
    return result
  except Exception as exc: return {"status":"error","reason":"worker protocol error: "+type(exc).__name__}
if __name__ == "__main__": json.dump(main(),sys.stdout,separators=(",",":"))
