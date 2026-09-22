#!/usr/bin/env python3
"""Default-off, shadow-only executor for a frozen Jev pilot package.

This driver never reads pilot labels.  It validates the package and frozen saved
functions before a provider call, journals each atomic attempt durably before it
starts, and makes no retry.  It enforces a cap on logical AIFunction attempts,
not a billing or physical HTTP-request cap.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import uuid
import tempfile
import fcntl
import signal
import subprocess
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

# Import the package-only checker; it deliberately does not open expected labels.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import jev_pilot

FUNCTIONS = ("evidenceSufficient", "trackingBehaviorPreserved")
LABELS = {"pass", "fail", "insufficient"}
MAX_ROWS = 12
MAX_ATOMIC_ATTEMPTS = 24
MAX_ATOMIC_SECONDS = 60
CONFIG_SCHEMA = "jev-pilot-execution-config-v1"


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value: object) -> str:
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def fail(message: str) -> None:
    raise ValueError(message)


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = jev_pilot.read_json(path)
    except OSError as error:
        raise ValueError(f"unable to read {path.name}") from error
    if not isinstance(value, dict):
        fail(f"{path.name} must be a JSON object")
    return value


def native_definition(state: Mapping[str, Any]) -> dict[str, Any]:
    candidate = state.get("current_candidate")
    backend = state.get("backend")
    columns = state.get("selected_columns")
    if not isinstance(candidate, dict) or not isinstance(backend, dict):
        fail("saved function state is missing candidate/backend")
    if columns != ["observation"] or state.get("column_mode", "selected") != "selected":
        fail("saved function must select only observation")
    return {
        "candidate": candidate,
        "backend": backend,
        "selected_columns": columns,
        "column_mode": state.get("column_mode", "selected"),
    }


@dataclass(frozen=True)
class PreparedRun:
    package: Path
    rows: list[dict[str, Any]]
    rubric_hash: str
    seed_manifest: dict[str, Any]
    provider: str
    model: str
    seed_manifest_path: Path


def validate_seed_manifest(path: Path, *, rubric_hash: str, rubric: Mapping[str, Any]) -> tuple[dict[str, Any], str, str]:
    """Validate the outer seed manifest and the two persisted native definitions."""
    manifest = read_json(path)
    declared_hash = manifest.get("manifestHash")
    payload = dict(manifest)
    payload.pop("manifestHash", None)
    if not isinstance(declared_hash, str) or digest(payload) != declared_hash:
        fail("outer seed manifest identity mismatch")
    if manifest.get("status") != "seed" or manifest.get("rubricHash") != rubric_hash or manifest.get("preprocessingVersion") != rubric.get("preprocessingVersion") or manifest.get("rubricVersion") != rubric.get("rubricVersion") or not isinstance(manifest.get("policyVersion"), str) or not manifest["policyVersion"]:
        fail("seed manifest rubric/policy identity mismatch")
    functions = manifest.get("functions")
    if not isinstance(functions, dict) or set(functions) != set(FUNCTIONS):
        fail("seed manifest must define exactly two functions")
    providers: set[str] = set()
    models: set[str] = set()
    root = path.resolve().parent
    for name in FUNCTIONS:
        spec = functions[name]
        if not isinstance(spec, dict):
            fail("seed function specification is invalid")
        definition_hash, provider, model, saved_path = (
            spec.get("definitionHash"), spec.get("provider"), spec.get("model"), spec.get("path")
        )
        if not all(isinstance(value, str) and value for value in (definition_hash, provider, model, saved_path)):
            fail("seed function identity is incomplete")
        state_path = Path(saved_path).expanduser() / "state.json"
        if not state_path.is_absolute():
            state_path = root / state_path
        if not state_path.is_file():
            fail(f"saved function state missing: {name}")
        state = read_json(state_path)
        definition = native_definition(state)
        if digest(definition) != definition_hash:
            fail(f"saved function definition identity mismatch: {name}")
        backend = definition["backend"]
        if backend.get("provider") != provider or backend.get("model") != model:
            fail(f"saved function provider/model identity mismatch: {name}")
        if state.get("source_sha256") != rubric_hash:
            fail(f"saved function rubric source identity mismatch: {name}")
        expected = rubric.get("functions", {}).get(name) if isinstance(rubric.get("functions"), dict) else None
        candidate = definition["candidate"]
        if not isinstance(expected, dict) or candidate.get("instructions") != expected.get("description") or candidate.get("criteria") != expected.get("labels"):
            fail(f"saved function rubric definition mismatch: {name}")
        providers.add(provider)
        models.add(model)
    if len(providers) != 1 or len(models) != 1:
        fail("two saved functions must bind one provider/model")
    provider, model = next(iter(providers)), next(iter(models))
    if manifest.get("requestedModel") != model:
        fail("outer seed manifest requested model mismatch")
    return manifest, provider, model


def input_preflight(package: Path) -> tuple[list[dict[str, Any]], str, dict[str, Any]]:
    """Validate every executable package byte without opening expected-label bytes."""
    package = package.resolve()
    checksums = read_json(package / "checksums.json")
    if not checksums or not all(isinstance(name, str) and "/" not in name and isinstance(value, str) and len(value) == 64 for name, value in checksums.items()):
        fail("checksum inventory missing or invalid")
    required = {"rubric.json", "pilot-inputs.jsonl", "manifest.json"}
    if not required <= set(checksums):
        fail("checksum inventory lacks executable package files")
    # Label/holdout inventory entries are deliberately neither statted, opened,
    # hashed, parsed, nor projected by this driver.
    for name in required:
        path, expected = package / name, checksums[name]
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            fail(f"checksum mismatch: {name}")
    manifest, rubric = read_json(package / "manifest.json"), read_json(package / "rubric.json")
    if manifest.get("schemaVersion") != "jev-pilot-package-v1" or rubric.get("status") != "seed":
        fail("unsupported pilot package or rubric")
    functions = rubric.get("functions")
    if not isinstance(functions, dict) or set(functions) != set(FUNCTIONS):
        fail("pilot rubric must define exactly two functions")
    for function in functions.values():
        if not isinstance(function, dict) or not isinstance(function.get("description"), str) or not function["description"] or not isinstance(function.get("labels"), dict) or set(function["labels"]) != LABELS:
            fail("pilot rubric is invalid")
    rubric_hash = digest(rubric)
    if manifest.get("rubricHash") != rubric_hash:
        fail("pilot manifest rubric identity mismatch")
    rows = jev_pilot.read_jsonl(package / "pilot-inputs.jsonl")
    if not rows or len(rows) > MAX_ROWS:
        fail("pilot row cap is 12")
    ids: set[str] = set(); hashes: set[str] = set()
    for row in rows:
        jev_pilot.validate_row(row, rubric_hash)
        if row["recordId"] in ids or row["inputHash"] in hashes:
            fail("duplicate pilot record or input")
        ids.add(row["recordId"]); hashes.add(row["inputHash"])
    if manifest.get("pilotObservations") != len(rows) or manifest.get("maxAtomicEvaluations") != len(rows) * len(FUNCTIONS):
        fail("pilot manifest row/evaluation count mismatch")
    return rows, rubric_hash, rubric


def prepare(package: Path, seed_manifest: Path) -> PreparedRun:
    package = package.resolve()
    rows, rubric_hash, rubric = input_preflight(package)
    if len(rows) * len(FUNCTIONS) > MAX_ATOMIC_ATTEMPTS:
        fail("pilot exceeds execution attempt cap")
    manifest, provider, model = validate_seed_manifest(seed_manifest, rubric_hash=rubric_hash, rubric=rubric)
    return PreparedRun(package, rows, rubric_hash, manifest, provider, model, seed_manifest.resolve())


def validate_execution_config_object(config: Mapping[str, Any], prepared: PreparedRun) -> dict[str, Any]:
    """Bind an explicit shadow provider/model; pricing is intentionally absent."""
    config = dict(config)
    required = {"schemaVersion", "mode", "provider", "model"}
    if set(config) != required or config.get("schemaVersion") != CONFIG_SCHEMA:
        fail("execution config identity is incomplete")
    if config.get("mode") != "shadow" or config.get("provider") != prepared.provider or config.get("model") != prepared.model:
        fail("execution config provider/model identity mismatch")
    return config

def validate_execution_config(path: Path, prepared: PreparedRun) -> dict[str, Any]:
    return validate_execution_config_object(read_json(path), prepared)


def credential_error(provider: str, environment: Mapping[str, str]) -> str | None:
    required = {
        "typesafe": ("TYPESAFE_API_KEY",),
        "cloudflare": ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"),
        "vercel": ("AI_GATEWAY_API_KEY",),
    }.get(provider)
    if required is None:
        return "unsupported Jev provider"
    missing = [name for name in required if not environment.get(name)]
    return None if not missing else f"missing provider credentials: {', '.join(missing)}"


def append_jsonl(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(canonical(value) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def existing_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return jev_pilot.read_jsonl(path)


def prediction_choice(prediction: Any) -> str:
    choice = getattr(prediction, "choice", None)
    if choice not in LABELS:
        fail("native prediction choice is not an atomic label")
    return choice


def load_native_functions(prepared: PreparedRun) -> dict[str, Any]:
    try:
        from jev_align import AIFunction
    except ImportError as error:
        raise ValueError("jev_align is not installed") from error
    loaded: dict[str, Any] = {}
    try:
        for name in FUNCTIONS:
            loaded[name] = AIFunction.load(prepared.seed_manifest["functions"][name]["path"])
        for name in FUNCTIONS:
            definition = getattr(loaded[name], "_definition", None)
            if not isinstance(definition, dict) or digest(definition) != prepared.seed_manifest["functions"][name]["definitionHash"]:
                fail(f"loaded native function identity mismatch: {name}")
        return loaded
    except Exception:
        close_native_functions(loaded)
        raise


class DirectCloudflareFunction:
    """One killable no-retry subprocess per reserved atomic evaluation."""
    def __init__(self, name: str, state: Mapping[str, Any], model: str, environment: Mapping[str, str]):
        self.name, self.model, self.environment = name, model, environment
        candidate = native_definition(state)["candidate"]
        self.instructions, self.criteria = candidate["instructions"], candidate["criteria"]
    def __call__(self, *, observation: Mapping[str, Any]) -> Any:
        request={"model":self.model,"observation":observation,"question":{"name":self.name,"instructions":self.instructions,"criteria":self.criteria}}
        env={"PATH":os.environ.get("PATH","")}
        for key in ("CLOUDFLARE_ACCOUNT_ID","CLOUDFLARE_API_TOKEN"): env[key]=self.environment[key]
        child=subprocess.Popen([sys.executable,str(Path(__file__).with_name("jev_cloudflare_direct.py"))],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,start_new_session=True,env=env)
        try: output,_=child.communicate(json.dumps(request),timeout=MAX_ATOMIC_SECONDS)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL); child.communicate(); raise AtomicTimeout("direct Cloudflare subprocess timed out")
        if child.returncode != 0: fail("direct Cloudflare evaluation failed")
        try: value=json.loads(output)
        except json.JSONDecodeError as error: raise ValueError("direct Cloudflare response malformed") from error
        if not isinstance(value,dict) or "error" in value or value.get("choice") not in LABELS or not isinstance(value.get("metadata"),dict): fail("direct Cloudflare response rejected")
        return type("Prediction",(),{"choice":value["choice"],"metadata":value["metadata"]})()
    def close(self) -> None: pass

def load_direct_cloudflare_functions(prepared: PreparedRun, environment: Mapping[str,str]) -> dict[str, Any]:
    if prepared.provider != "cloudflare": fail("direct Cloudflare transport requires a cloudflare seed")
    return {name: DirectCloudflareFunction(name,read_json(Path(prepared.seed_manifest["functions"][name]["path"])/"state.json"),prepared.model,environment) for name in FUNCTIONS}


def close_native_functions(functions: Mapping[str, Any]) -> None:
    for function in functions.values():
        close = getattr(function, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                pass


def result_record(row: Mapping[str, Any], prepared: PreparedRun, run_id: str, *, status: str, answers: dict[str, str] | None = None, reason: str | None = None) -> dict[str, Any]:
    record: dict[str, Any] = {
        "recordId": row["recordId"], "inputHash": row["inputHash"], "rubricHash": prepared.rubric_hash,
        "runId": run_id, "provider": prepared.provider, "model": prepared.model, "status": status,
    }
    if status == "success":
        if answers is None or set(answers) != set(FUNCTIONS):
            fail("success record is incomplete")
        record["answers"] = answers
    else:
        record["reason"] = reason or "execution did not complete"
    return record


class AtomicTimeout(TimeoutError):
    pass


@contextmanager
def journal_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def call_with_timeout(function: Any, observation: Mapping[str, Any]) -> Any:
    if not hasattr(signal, "setitimer") or signal.getsignal(signal.SIGALRM) is None:
        fail("platform cannot enforce an atomic evaluation timeout")
    def expire(_signum: int, _frame: Any) -> None:
        raise AtomicTimeout(f"atomic evaluation exceeded {MAX_ATOMIC_SECONDS} seconds")
    previous = signal.signal(signal.SIGALRM, expire)
    signal.setitimer(signal.ITIMER_REAL, MAX_ATOMIC_SECONDS)
    try:
        return function(observation=observation)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def run_header(prepared: PreparedRun, run_id: str, config: Mapping[str, Any]) -> dict[str, Any]:
    return {"event": "run-started", "runId": run_id, "rubricHash": prepared.rubric_hash,
            "seedManifestHash": prepared.seed_manifest["manifestHash"], "provider": prepared.provider,
            "model": prepared.model, "configHash": digest(config),
            "inputs": [{"recordId": row["recordId"], "inputHash": row["inputHash"]} for row in prepared.rows]}


def journal_state(path: Path, prepared: PreparedRun, run_id: str, config: Mapping[str, Any]) -> tuple[dict[tuple[str, str], dict[str, Any]], dict[str, dict[str, Any]]]:
    events = existing_jsonl(path)
    header = run_header(prepared, run_id, config)
    if not events:
        append_jsonl(path, header); events = [header]
    if events[0] != header:
        fail("journal immutable run header mismatch")
    attempts: dict[tuple[str, str], dict[str, Any]] = {}
    completed: dict[str, dict[str, Any]] = {}
    rows = {row["recordId"]: row for row in prepared.rows}
    seed_hash = prepared.seed_manifest["manifestHash"]
    for event in events[1:]:
        record_id = event.get("recordId")
        if record_id not in rows or event.get("runId") != run_id or event.get("rubricHash") != prepared.rubric_hash or event.get("inputHash") != rows[record_id]["inputHash"] or event.get("provider") != prepared.provider or event.get("model") != prepared.model or event.get("seedManifestHash") != seed_hash:
            fail("journal identity mismatch")
        kind = event.get("event")
        if kind in {"attempt-started", "attempt-finished"}:
            name = event.get("function"); key = (record_id, name)
            if name not in FUNCTIONS or not isinstance(event.get("atomicAttempt"), int) or not 1 <= event["atomicAttempt"] <= MAX_ATOMIC_ATTEMPTS:
                fail("journal atomic attempt is invalid")
            if kind == "attempt-started":
                if key in attempts or any(item.get("atomicAttempt") == event["atomicAttempt"] for item in attempts.values()):
                    fail("journal contains duplicate atomic attempt")
                attempts[key] = event
            else:
                started = attempts.get(key)
                if started is None or started.get("event") != "attempt-started" or event.get("atomicAttempt") != started.get("atomicAttempt") or event.get("status") not in {"success", "error"}:
                    fail("journal finished an unstarted or duplicate function")
                if event["status"] == "success" and event.get("answer") not in LABELS:
                    fail("journal atomic answer is invalid")
                attempts[key] = event
        elif kind == "record-finished":
            if record_id in completed or event.get("status") not in {"success", "error", "abstained"}:
                fail("journal completed record is invalid")
            completed[record_id] = event
        else:
            fail("journal event is invalid")
    if len(attempts) > MAX_ATOMIC_ATTEMPTS:
        fail("journal exceeds atomic attempt cap")
    for record_id, record in completed.items():
        if record["status"] == "success":
            answers = record.get("answers")
            if not isinstance(answers, dict) or set(answers) != set(FUNCTIONS):
                fail("journal success record answers are invalid")
            for name in FUNCTIONS:
                atomic = attempts.get((record_id, name))
                if atomic is None or atomic.get("event") != "attempt-finished" or atomic.get("status") != "success" or atomic.get("answer") != answers[name]:
                    fail("journal success record does not match atomic attempts")
        elif "answers" in record or not isinstance(record.get("reason"), str):
            fail("journal non-success record is invalid")
    return attempts, completed

def synchronize_results(path: Path, prepared: PreparedRun, completed: Mapping[str, Mapping[str, Any]]) -> None:
    """Atomically project the authoritative journal without overwriting unrelated output."""
    wanted = []
    for row in prepared.rows:
        event = completed.get(row["recordId"])
        if event is not None:
            wanted.append(canonical({key: value for key, value in event.items() if key not in {"event", "seedManifestHash"}}))
    if path.exists():
        try:
            actual = [canonical(item) for item in existing_jsonl(path)]
        except (ValueError, json.JSONDecodeError) as error:
            raise ValueError("existing results do not match this authoritative journal") from error
        if actual != wanted[:len(actual)]:
            fail("existing results do not match this authoritative journal")
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False) as handle:
        temporary = Path(handle.name)
        handle.write("".join(item + "\n" for item in wanted)); handle.flush(); os.fsync(handle.fileno())
    try:
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory_fd)
        finally: os.close(directory_fd)
    finally:
        if temporary.exists(): temporary.unlink()

def execute(
    prepared: PreparedRun,
    *, config: dict[str, Any], results_path: Path, journal_path: Path, run_id: str,
    environment: Mapping[str, str] | None = None,
    loader: Callable[[PreparedRun], dict[str, Any]] = load_native_functions,
    provider_guard: Callable[[PreparedRun, Mapping[str, Any]], None] | None = None,
    direct_cloudflare: bool = False,
) -> dict[str, Any]:
    """Execute a fake/reviewed transport only after a caller-supplied hard-control guard.

    The CLI intentionally supplies no guard in this milestone, so it cannot make
    provider calls. Tests inject an in-memory fake guard and transport.
    """
    config = validate_execution_config_object(config, prepared)
    inventory = read_json(prepared.package / "checksums.json")
    protected = {prepared.package / name for name in inventory}
    protected.update({prepared.package / "checksums.json", prepared.seed_manifest_path})
    for function_name in FUNCTIONS:
        protected.add(Path(prepared.seed_manifest["functions"][function_name]["path"]) / "state.json")
    paths = {results_path.resolve(), journal_path.resolve(), journal_path.with_name(journal_path.name + ".lock").resolve()}
    if len(paths) != 3 or any(item.resolve() in paths for item in protected):
        fail("results/journal path collides with a protected artifact")
    if provider_guard is None and not direct_cloudflare:
        fail("no reviewed transport is available; provider calls remain blocked")
    if direct_cloudflare and prepared.provider != "cloudflare":
        fail("direct Cloudflare transport requires a cloudflare seed")
    # Pinned TypeSafe retries are opaque to AIFunction. Refuse this path rather
    # than let one logical attempt silently consume multiple transport requests.
    if prepared.provider == "typesafe":
        fail("pinned TypeSafe backend has hidden SDK retries; use a reviewed no-retry transport")
    environment = os.environ if environment is None else environment
    error = credential_error(prepared.provider, environment)
    if error:
        fail(error)
    if provider_guard is not None: provider_guard(prepared, config)
    if direct_cloudflare: loader = lambda _: load_direct_cloudflare_functions(prepared, environment)
    with journal_lock(journal_path.with_name(journal_path.name + ".lock")):
        attempts, completed = journal_state(journal_path, prepared, run_id, config)
        synchronize_results(results_path, prepared, completed)
        functions = loader(prepared)
        try:
            for row in prepared.rows:
                record_id = row["recordId"]
                if record_id in completed:
                    continue
                prior = {name: event for (item, name), event in attempts.items() if item == record_id}
                interrupted = [name for name, event in prior.items() if event.get("event") == "attempt-started"]
                if interrupted:
                    record = result_record(row, prepared, run_id, status="error", reason="interrupted after atomic attempt started")
                    finished = {"event": "record-finished", "seedManifestHash": prepared.seed_manifest["manifestHash"], **record}
                    append_jsonl(journal_path, finished); completed[record_id] = finished
                    continue
                answers: dict[str, str] = {}
                provider_evaluations: dict[str, Any] = {}
                failure: str | None = None
                for name in FUNCTIONS:
                    old = prior.get(name)
                    if old is not None:
                        if old.get("event") != "attempt-finished" or old.get("status") != "success" or old.get("answer") not in LABELS:
                            failure = "previous atomic attempt did not complete"; break
                        answers[name] = old["answer"]
                        if isinstance(old.get("providerMetadata"), dict): provider_evaluations[name] = old["providerMetadata"]
                        continue
                    if len(attempts) >= MAX_ATOMIC_ATTEMPTS:
                        failure = "atomic attempt cap reached"; break
                    attempt = {"event": "attempt-started", "runId": run_id, "recordId": record_id, "inputHash": row["inputHash"], "rubricHash": prepared.rubric_hash, "provider": prepared.provider, "model": prepared.model, "seedManifestHash": prepared.seed_manifest["manifestHash"], "function": name, "atomicAttempt": len(attempts) + 1}
                    append_jsonl(journal_path, attempt)
                    attempts[(record_id, name)] = attempt
                    try:
                        # The only object crossing the judge boundary is this observation.
                        prediction = call_with_timeout(functions[name], row["input"]["observation"])
                        answer = prediction_choice(prediction)
                        metadata = getattr(prediction, "metadata", None)
                    except Exception as exc:
                        failure = f"atomic function error: {type(exc).__name__}"
                        finished_event = {**attempt, "event": "attempt-finished", "status": "error", "reason": failure}
                        append_jsonl(journal_path, finished_event); attempts[(record_id, name)] = finished_event
                        break
                    answers[name] = answer
                    finished_event = {**attempt, "event": "attempt-finished", "status": "success", "answer": answer}
                    if isinstance(metadata, dict):
                        finished_event["providerMetadata"] = metadata
                        provider_evaluations[name] = metadata
                    append_jsonl(journal_path, finished_event); attempts[(record_id, name)] = finished_event
                record = result_record(row, prepared, run_id, status="success", answers=answers) if failure is None and set(answers) == set(FUNCTIONS) else result_record(row, prepared, run_id, status="error", reason=failure or "incomplete atomic answers")
                if provider_evaluations: record["providerEvaluations"] = provider_evaluations
                finished = {"event": "record-finished", "seedManifestHash": prepared.seed_manifest["manifestHash"], **record}
                append_jsonl(journal_path, finished); completed[record_id] = finished
        finally:
            close_native_functions(functions)
        synchronize_results(results_path, prepared, completed)
    records = existing_jsonl(results_path)
    return {"mode": "shadow", "runId": run_id, "records": len(records), "atomicAttempts": len(attempts), "atomicAttemptCap": MAX_ATOMIC_ATTEMPTS, "results": str(results_path.resolve()), "journal": str(journal_path.resolve()), "requestLimit": "logical AIFunction attempts only; no physical HTTP or dollar cap is claimed"}

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("preflight", "run"))
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--seed-manifest", type=Path, required=True)
    parser.add_argument("--execution-config", type=Path)
    parser.add_argument("--results", type=Path)
    parser.add_argument("--journal", type=Path)
    parser.add_argument("--run-id")
    parser.add_argument("--execute", action="store_true", help="permit provider calls after all gates succeed")
    parser.add_argument("--direct-cloudflare", action="store_true", help="use the direct no-retry Cloudflare Jev REST transport")
    args = parser.parse_args()
    prepared = prepare(args.package, args.seed_manifest)
    if args.command == "preflight":
        config_status = "not supplied; execution remains blocked"
        if args.execution_config:
            validate_execution_config(args.execution_config, prepared)
            config_status = "validated; execution still default-off"
        print(json.dumps({"mode": "shadow", "providerCalls": 0, "records": len(prepared.rows), "atomicAttemptCap": MAX_ATOMIC_ATTEMPTS, "seedManifestHash": prepared.seed_manifest["manifestHash"], "provider": prepared.provider, "model": prepared.model, "executionConfig": config_status}, indent=2))
        return
    if not args.results or not args.journal:
        fail("run requires --results and --journal")
    if not args.execute:
        print(json.dumps({"mode": "shadow", "providerCalls": 0, "status": "default-off; use --execute only after external authorization"}, indent=2))
        return
    if not args.execution_config:
        fail("execution config is required before any provider call")
    config = validate_execution_config(args.execution_config, prepared)
    print(json.dumps(execute(prepared, config=config, results_path=args.results, journal_path=args.journal, run_id=args.run_id or str(uuid.uuid4()), direct_cloudflare=args.direct_cloudflare), indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, json.JSONDecodeError) as error:
        print(f"jev pilot execution rejected: {error}", file=sys.stderr)
        raise SystemExit(2)
