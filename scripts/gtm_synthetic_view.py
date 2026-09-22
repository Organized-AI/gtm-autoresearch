"""Validate and expose a fixed, truth-free synthetic-data download bundle."""
from __future__ import annotations

import hashlib
import io
import re
import stat
import zipfile
from pathlib import Path

try:
    from jev_pilot import parse_json
except ModuleNotFoundError:
    from scripts.jev_pilot import parse_json

MAX_BYTES = 8_000_000
FILES = ("summary.json", "dataset.zip")
SUMMARY_KEYS = {
    "schemaVersion", "datasetSchema", "trainOnly", "synthetic", "caseCount",
    "sessionsPerCase", "journeyFamilies", "observedDate", "archive", "notices",
}
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def _nonempty_string(value):
    return isinstance(value, str) and bool(value.strip())


def _nonnegative_int(value):
    return type(value) is int and value >= 0


def _read_file(root: Path, name: str):
    path = root / name
    if path.is_symlink() or not path.is_file():
        raise ValueError("Synthetic bundle files must be regular files")
    with path.open("rb") as handle:
        data = handle.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Synthetic bundle artifact exceeds the viewer size limit")
    return data


def _validate_archive(dataset: bytes):
    try:
        with zipfile.ZipFile(io.BytesIO(dataset)) as archive:
            names = set()
            for member in archive.infolist():
                name = member.filename.replace("\\", "/")
                parts = [part for part in name.split("/") if part]
                mode = member.external_attr >> 16
                if (not name or name.startswith("/") or ".." in parts or "truth" in name.lower()
                        or name in names or member.flag_bits & 0x1
                        or stat.S_IFMT(mode) == stat.S_IFLNK):
                    raise ValueError("Synthetic archive contains an unsafe or truth-bearing entry")
                names.add(name)
            if not names:
                raise ValueError("Synthetic archive is empty")
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile) as error:
        raise ValueError("Synthetic archive is invalid") from error


def load_bundle(root: Path):
    if root is None or root.is_symlink() or not root.is_dir():
        raise ValueError("Synthetic bundle is unavailable")
    if {path.name for path in root.iterdir()} != set(FILES):
        raise ValueError("Synthetic bundle must contain exactly summary.json and dataset.zip")
    files = {name: _read_file(root, name) for name in FILES}
    summary = parse_json(files["summary.json"].decode("utf-8"))
    if not isinstance(summary, dict) or set(summary) != SUMMARY_KEYS:
        raise ValueError("Synthetic summary schema is invalid")
    archive = summary.get("archive")
    if (summary.get("schemaVersion") != "gtm-synthetic-download-v1"
            or not _nonempty_string(summary.get("datasetSchema"))
            or summary.get("trainOnly") is not True or summary.get("synthetic") is not True
            or not _nonnegative_int(summary.get("caseCount"))
            or not _nonnegative_int(summary.get("sessionsPerCase"))
            or not _nonempty_string(summary.get("observedDate"))
            or not isinstance(summary.get("journeyFamilies"), list)
            or not all(_nonempty_string(item) for item in summary["journeyFamilies"])
            or not isinstance(summary.get("notices"), list)
            or not all(_nonempty_string(item) for item in summary["notices"])
            or not isinstance(archive, dict) or set(archive) != {"sha256", "bytes"}
            or not isinstance(archive.get("sha256"), str) or not SHA256.fullmatch(archive["sha256"])
            or not _nonnegative_int(archive.get("bytes"))
            or archive["bytes"] != len(files["dataset.zip"])
            or archive["sha256"] != hashlib.sha256(files["dataset.zip"]).hexdigest()):
        raise ValueError("Synthetic summary integrity check failed")
    _validate_archive(files["dataset.zip"])
    return {"available": True, "summary": summary}, files


def synthetic_snapshot(root):
    if root is None:
        return {"available": False, "reason": "No synthetic-data bundle has been attached."}, {}
    try:
        return load_bundle(root)
    except (OSError, UnicodeDecodeError, ValueError, KeyError, TypeError, AttributeError):
        return {"available": False, "reason": "The synthetic-data bundle is missing or failed integrity checks. Downloads are unavailable."}, {}
