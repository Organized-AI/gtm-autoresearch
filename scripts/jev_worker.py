#!/usr/bin/env python3
"""Bounded JSON protocol for a frozen jev_align AIFunction shadow call."""
import json, os, sys

def unavailable(reason): return {"status":"unavailable","reason":reason}
def load_freeze(path):
  with open(path + ".freeze.json", encoding="utf-8") as handle: return json.load(handle)
def normalize_prediction(prediction):
  # jev-align Prediction semantics: choice/label_probabilities/score, not an
  # arbitrary `.values` mapping. Definitions must emit both atomic choices.
  choice=getattr(prediction,"choice",None)
  if not isinstance(choice,dict): raise ValueError("Prediction.choice must be an answer mapping")
  answers={"evidenceSufficient":choice.get("evidenceSufficient"),"trackingBehaviorPreserved":choice.get("trackingBehaviorPreserved")}
  if any(value not in ("pass","fail","insufficient") for value in answers.values()): raise ValueError("invalid atomic choices")
  probabilities=getattr(prediction,"label_probabilities",None); uncertainty=None
  if isinstance(probabilities,dict) and probabilities:
    values=[value for value in probabilities.values() if isinstance(value,(int,float)) and 0 <= value <= 1]
    if len(values)==len(probabilities): uncertainty=1-max(values)
  return answers, uncertainty, getattr(prediction,"model",None)
def main():
  try:
    request=json.load(sys.stdin); evidence=request["evidence"]
    if request.get("protocol") != "jev-shadow-v1": return {"status":"error","reason":"unsupported protocol"}
    definition_path=request.get("definitionPath")
    if not definition_path: return unavailable("definition path missing")
    try:
      frozen=load_freeze(definition_path)
    except OSError: return unavailable("frozen definition sidecar missing")
    required=evidence["frozen"]
    if frozen.get("definitionHash") != required.get("contentHash") or frozen.get("requestedModel") != required.get("requestedModel") or frozen.get("preprocessingVersion") != required.get("preprocessingVersion"):
      return {"status":"error","reason":"frozen definition identity mismatch"}
    try:
      from jev_align import AIFunction
      function=AIFunction.load(definition_path)
      answers, uncertainty, reported_model=normalize_prediction(function(**evidence))
    except ImportError: return unavailable("jev_align is not installed")
    except Exception as exc: return {"status":"error","reason":"worker evaluation failed: " + type(exc).__name__}
    if required.get("requestedModel") != "unconfigured" and reported_model != required.get("requestedModel"):
      return {"status":"error","reason":"reported model mismatch"}
    result={"status":"success","evidenceHash":evidence["evidenceHash"],"definitionHash":required["contentHash"],"requestedModel":required["requestedModel"],"answers":answers}
    if reported_model: result["reportedModel"]=reported_model
    if uncertainty is not None: result["uncertainty"]=uncertainty
    return result
  except Exception as exc: return {"status":"error","reason":"worker protocol error: " + type(exc).__name__}
if __name__ == "__main__": json.dump(main(),sys.stdout,separators=(",",":"))
