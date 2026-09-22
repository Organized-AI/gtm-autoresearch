"""Read a fixed, checksum-bound scored container bundle for the local viewer."""
import hashlib
from pathlib import Path

try:
    from jev_pilot import parse_json
except ModuleNotFoundError:
    from scripts.jev_pilot import parse_json

MAX_BYTES = 8_000_000
FILES = ("container.json", "report.json", "manifest.json")


def load_bundle(root: Path):
    files = {}
    for name in FILES:
        path = root / name
        if path.is_symlink():
            raise ValueError("Bundle files must not be symlinks")
        with path.open("rb") as handle:
            files[name] = handle.read(MAX_BYTES + 1)
        if len(files[name]) > MAX_BYTES:
            raise ValueError("Export artifact exceeds the viewer size limit")
    manifest = parse_json(files["manifest.json"].decode("utf-8"))
    report = parse_json(files["report.json"].decode("utf-8"))
    container = parse_json(files["container.json"].decode("utf-8"))
    if manifest.get("schemaVersion") != "gtm-scored-export-v1" or report.get("schemaVersion") != "gtm-scored-export-v1":
        raise ValueError("Unsupported export bundle")
    hashes = {name: hashlib.sha256(files[name]).hexdigest() for name in FILES[:2]}
    if manifest.get("files") != hashes or report.get("source", {}).get("sha256") != hashes["container.json"]:
        raise ValueError("Export checksum mismatch")
    if container.get("exportFormatVersion") != 2 or not isinstance(container.get("containerVersion"), dict):
        raise ValueError("Unsupported GTM export format")
    validation, readiness = report["validation"], report["readiness"]
    if validation["status"] not in {"passed", "blocked"} or readiness["status"] not in {"ready-for-import-review", "blocked"}:
        raise ValueError("Invalid export readiness")
    if not all(isinstance(items, list) and all(isinstance(item, str) for item in items)
               for items in (validation["errors"], validation["warnings"], readiness["blockers"])):
        raise ValueError("Invalid validation findings")
    ready = (validation["status"] == "passed" and readiness["status"] == "ready-for-import-review"
             and not validation["errors"] and not readiness["blockers"])
    return {"available": True, "downloadReady": ready, "report": report,
            "sha256": hashes["container.json"]}, files


def export_snapshot(root):
    if root is None:
        return {"available": False, "reason": "No scored container has been attached. The Jev pilot did not produce a container."}, {}
    try:
        return load_bundle(root)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {"available": False, "reason": "The scored export is missing or failed integrity checks. Downloads are unavailable."}, {}
