"""Locked real-API pilot comparing two OpenAI model routes."""

from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

DEFAULT_EXPERIMENT_ID = "openai-model-route-002"
EXPERIMENT_PATTERN = re.compile(r"openai-model-route-\d{3}\Z")
CASE_SCHEMA_VERSIONS = {
    "ai-cost-lens-model-route-cases/1.0",
    "ai-cost-lens-model-route-cases/2.0",
}
ANSWER_SCHEMA_VERSIONS = {
    "ai-cost-lens-model-route-answer-key/1.0",
    "ai-cost-lens-model-route-answer-key/2.0",
}
ROUTES = {
    "baseline": {
        "model": "gpt-5.6-sol",
        "key_environment_variable": "AI_COST_LENS_BASELINE_KEY",
    },
    "proposed": {
        "model": "gpt-5.6-luna",
        "key_environment_variable": "AI_COST_LENS_PROPOSED_KEY",
    },
}
ENDPOINT = "https://api.openai.com/v1/responses"
MAX_OUTPUT_TOKENS = 500
CLAIM_STATES = {
    "VERIFIED_FACT",
    "COMPANY_CLAIM",
    "UNKNOWN",
    "CONTRADICTED",
}


class ModelRoutePilotError(ValueError):
    """Raised when the locked model-route pilot cannot run safely."""


def _load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ModelRoutePilotError(f"{label} not found: {path}") from exc
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ModelRoutePilotError(f"unable to read {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise ModelRoutePilotError(f"{label} must contain a JSON object")
    return value


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _paths(root: Path, experiment_id: str) -> tuple[Path, Path, Path]:
    if not EXPERIMENT_PATTERN.fullmatch(experiment_id):
        raise ModelRoutePilotError("experiment identifier is not valid")
    experiment = root / "experiments" / experiment_id
    return (
        experiment / "cases.json",
        experiment / "answer-key.json",
        experiment / "system-prompt.txt",
    )


def _validate_inputs(
    cases_document: Mapping[str, Any],
    answer_document: Mapping[str, Any],
    experiment_id: str,
) -> tuple[list[dict[str, Any]], Mapping[str, Any]]:
    case_schema = cases_document.get("schema_version")
    answer_schema = answer_document.get("schema_version")
    if case_schema not in CASE_SCHEMA_VERSIONS:
        raise ModelRoutePilotError("case file schema is not supported")
    if answer_schema not in ANSWER_SCHEMA_VERSIONS:
        raise ModelRoutePilotError("answer-key schema is not supported")
    if str(case_schema).rsplit("/", 1)[-1] != str(answer_schema).rsplit("/", 1)[-1]:
        raise ModelRoutePilotError("case and answer-key schema versions do not match")
    if (
        cases_document.get("experiment_id") != experiment_id
        or answer_document.get("experiment_id") != experiment_id
    ):
        raise ModelRoutePilotError("experiment identifiers do not match")
    cases = cases_document.get("cases")
    answers = answer_document.get("answers")
    if not isinstance(cases, list) or not cases:
        raise ModelRoutePilotError("case file must contain cases")
    if not isinstance(answers, Mapping):
        raise ModelRoutePilotError("answer key must contain answers")
    identifiers = []
    for index, case in enumerate(cases, start=1):
        if not isinstance(case, dict):
            raise ModelRoutePilotError(f"case {index} must be an object")
        case_id = str(case.get("case_id") or "").strip()
        situation = str(case.get("situation") or "").strip()
        claims = case.get("claims")
        if not case_id or not situation or not isinstance(claims, list) or not claims:
            raise ModelRoutePilotError(f"case {index} is missing required evidence")
        claim_ids = []
        for claim in claims:
            if not isinstance(claim, Mapping):
                raise ModelRoutePilotError(f"{case_id} contains an invalid claim")
            claim_id = str(claim.get("claim_id") or "").strip()
            claim_text = str(claim.get("text") or "").strip()
            if not claim_id or not claim_text:
                raise ModelRoutePilotError(
                    f"{case_id} contains a claim without an identifier or text"
                )
            claim_ids.append(claim_id)
        if len(set(claim_ids)) != len(claim_ids):
            raise ModelRoutePilotError(f"{case_id} claim identifiers must be unique")
        if case_schema == "ai-cost-lens-model-route-cases/2.0":
            decision_question = str(case.get("decision_question") or "").strip()
            required_metric = case.get("required_metric")
            if not decision_question or not isinstance(required_metric, Mapping):
                raise ModelRoutePilotError(
                    f"{case_id} must define a decision question and required metric"
                )
            metric_label = str(required_metric.get("label") or "").strip()
            metric_unit = str(required_metric.get("unit") or "").strip()
            nullable = required_metric.get("nullable")
            if not metric_label or not metric_unit or not isinstance(nullable, bool):
                raise ModelRoutePilotError(f"{case_id} required metric is incomplete")
        answer = answers.get(case_id)
        if not isinstance(answer, Mapping):
            raise ModelRoutePilotError(f"{case_id} answer must be an object")
        if answer.get("decision") not in {"APPROVE", "INVESTIGATE", "REJECT"}:
            raise ModelRoutePilotError(f"{case_id} answer has an invalid decision")
        answer_metric_value = answer.get("metric_value")
        if answer_metric_value is not None:
            try:
                metric_value = float(answer_metric_value)
            except (TypeError, ValueError) as exc:
                raise ModelRoutePilotError(
                    f"{case_id} answer metric must be numeric or null"
                ) from exc
            if not math.isfinite(metric_value):
                raise ModelRoutePilotError(f"{case_id} answer metric must be finite")
        if not str(answer.get("metric_unit") or "").strip():
            raise ModelRoutePilotError(f"{case_id} answer metric unit is required")
        if case_schema == "ai-cost-lens-model-route-cases/2.0":
            if answer.get("metric_label_exact") is not True:
                raise ModelRoutePilotError(
                    f"{case_id} answer must require the locked metric label"
                )
            if answer.get("metric_label") != required_metric.get("label"):
                raise ModelRoutePilotError(
                    f"{case_id} answer metric label does not reconcile"
                )
            if answer.get("metric_unit") != required_metric.get("unit"):
                raise ModelRoutePilotError(
                    f"{case_id} answer metric unit does not reconcile"
                )
            if (answer_metric_value is None) != bool(required_metric.get("nullable")):
                raise ModelRoutePilotError(
                    f"{case_id} metric nullability does not reconcile"
                )
        claim_states = answer.get("claim_states")
        if not isinstance(claim_states, Mapping) or set(claim_states) != set(claim_ids):
            raise ModelRoutePilotError(
                f"{case_id} answer claim states do not reconcile"
            )
        if not set(claim_states.values()).issubset(CLAIM_STATES):
            raise ModelRoutePilotError(
                f"{case_id} answer contains an unsupported claim state"
            )
        identifiers.append(case_id)
    if len(set(identifiers)) != len(identifiers):
        raise ModelRoutePilotError("case identifiers must be unique")
    if set(identifiers) != set(answers):
        raise ModelRoutePilotError("case file and answer key do not reconcile")
    return cases, answers


def _response_schema(case: Mapping[str, Any]) -> dict[str, Any]:
    required_metric = case.get("required_metric")
    metric_label: dict[str, Any] = {"type": "string"}
    metric_value: dict[str, Any] = {"type": "number"}
    metric_unit: dict[str, Any] = {"type": "string"}
    if isinstance(required_metric, Mapping):
        metric_label["enum"] = [required_metric["label"]]
        metric_unit["enum"] = [required_metric["unit"]]
        if required_metric.get("nullable"):
            metric_value["type"] = ["number", "null"]
    claim_ids = [
        claim["claim_id"]
        for claim in case.get("claims", [])
        if isinstance(claim, Mapping) and claim.get("claim_id")
    ]
    return {
        "type": "object",
        "properties": {
            "case_id": {"type": "string"},
            "decision": {
                "type": "string",
                "enum": ["APPROVE", "INVESTIGATE", "REJECT"],
            },
            "primary_metric": {
                "type": "object",
                "properties": {
                    "label": metric_label,
                    "value": metric_value,
                    "unit": metric_unit,
                },
                "required": ["label", "value", "unit"],
                "additionalProperties": False,
            },
            "claim_assessments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "claim_id": {
                            "type": "string",
                            "enum": claim_ids,
                        },
                        "state": {
                            "type": "string",
                            "enum": sorted(CLAIM_STATES),
                        },
                    },
                    "required": ["claim_id", "state"],
                    "additionalProperties": False,
                },
                "minItems": len(claim_ids),
                "maxItems": len(claim_ids),
            },
            "memo": {"type": "string"},
            "next_question": {"type": "string"},
        },
        "required": [
            "case_id",
            "decision",
            "primary_metric",
            "claim_assessments",
            "memo",
            "next_question",
        ],
        "additionalProperties": False,
    }


def _payload(model: str, prompt: str, case: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "model": model,
        "input": [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": json.dumps(case, indent=2, sort_keys=True),
            },
        ],
        "reasoning": {"effort": "none"},
        "text": {
            "format": {
                "type": "json_schema",
                "name": "ai_finance_review",
                "strict": True,
                "schema": _response_schema(case),
            }
        },
        "max_output_tokens": MAX_OUTPUT_TOKENS,
        "store": False,
    }


def _post(payload: Mapping[str, Any], key: str) -> dict[str, Any]:
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            value = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ModelRoutePilotError(
            f"OpenAI returned HTTP {exc.code}: {detail}"
        ) from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ModelRoutePilotError(f"OpenAI request failed: {exc}") from exc
    if not isinstance(value, dict):
        raise ModelRoutePilotError("OpenAI response was not a JSON object")
    return value


def _output_text(response: Mapping[str, Any]) -> str:
    if response.get("status") != "completed":
        raise ModelRoutePilotError(
            f"response did not complete: {response.get('incomplete_details') or response.get('status')}"
        )
    for item in response.get("output", []):
        if isinstance(item, Mapping) and item.get("type") == "message":
            for content in item.get("content", []):
                if not isinstance(content, Mapping):
                    continue
                if content.get("type") == "refusal":
                    raise ModelRoutePilotError(
                        f"model refused the case: {content.get('refusal')}"
                    )
                if content.get("type") == "output_text":
                    return str(content.get("text") or "")
    raise ModelRoutePilotError("completed response contained no output text")


def score_output(
    output: Mapping[str, Any], case_id: str, answer: Mapping[str, Any]
) -> dict[str, Any]:
    checks: dict[str, bool] = {}
    checks["case_id"] = output.get("case_id") == case_id
    checks["decision"] = output.get("decision") == answer.get("decision")
    metric = output.get("primary_metric")
    if not isinstance(metric, Mapping):
        metric = {}
    if answer.get("metric_label_exact") is True:
        checks["metric_label"] = (
            str(metric.get("label") or "").strip()
            == str(answer.get("metric_label") or "").strip()
        )
    expected_raw = answer.get("metric_value")
    if expected_raw is None:
        checks["metric_value"] = metric.get("value") is None
    else:
        try:
            metric_value = float(metric.get("value"))
            expected_value = float(expected_raw)
            tolerance = max(abs(expected_value) * 0.001, 0.0001)
            checks["metric_value"] = abs(metric_value - expected_value) <= tolerance
        except (TypeError, ValueError):
            checks["metric_value"] = False
    checks["metric_unit"] = (
        str(metric.get("unit") or "").upper()
        == str(answer.get("metric_unit") or "").upper()
    )

    assessments = output.get("claim_assessments")
    actual_states = {}
    if isinstance(assessments, list):
        for assessment in assessments:
            if isinstance(assessment, Mapping):
                claim_id = str(assessment.get("claim_id") or "")
                state = str(assessment.get("state") or "")
                if claim_id and claim_id not in actual_states:
                    actual_states[claim_id] = state
    checks["claim_states"] = actual_states == dict(answer.get("claim_states") or {})
    memo = str(output.get("memo") or "")
    checks["memo_length"] = 1 <= len(memo.split()) <= 120
    checks["next_question"] = bool(str(output.get("next_question") or "").strip())
    return {
        "case_id": case_id,
        "auto_pass": all(checks.values()),
        "checks": checks,
        "human_review_required": True,
    }


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def _write_human_review_template(
    path: Path, results: list[Mapping[str, Any]], review_date: str
) -> None:
    fields = [
        "result_id",
        "date",
        "accepted",
        "model_requests",
        "retry_requests",
        "human_review_minutes",
        "correction_minutes",
        "auto_pass",
        "review_notes",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for result in results:
            writer.writerow(
                {
                    "result_id": result["case_id"],
                    "date": review_date,
                    "accepted": "",
                    "model_requests": 1,
                    "retry_requests": 0,
                    "human_review_minutes": "",
                    "correction_minutes": "",
                    "auto_pass": str(bool(result["auto_pass"])).lower(),
                    "review_notes": "",
                }
            )


def run_route(
    root: Path,
    route: str,
    output_dir: Path,
    *,
    experiment_id: str = DEFAULT_EXPERIMENT_ID,
    transport: Callable[[Mapping[str, Any], str], dict[str, Any]] = _post,
) -> dict[str, Any]:
    if route not in ROUTES:
        raise ModelRoutePilotError(f"route must be one of: {', '.join(ROUTES)}")
    if output_dir.exists():
        raise ModelRoutePilotError(f"output directory already exists: {output_dir}")
    config = ROUTES[route]
    key_field = config["key_environment_variable"]
    key = os.environ.get(key_field, "").strip()
    if not key:
        raise ModelRoutePilotError(f"{key_field} is not set")

    cases_path, answers_path, prompt_path = _paths(root, experiment_id)
    cases_document = _load_json(cases_path, "case file")
    answer_document = _load_json(answers_path, "answer key")
    cases, answers = _validate_inputs(cases_document, answer_document, experiment_id)
    prompt = prompt_path.read_text(encoding="utf-8").strip()
    if not prompt:
        raise ModelRoutePilotError("system prompt is empty")

    output_dir.mkdir(parents=True)
    response_dir = output_dir / "responses"
    parsed_dir = output_dir / "parsed"
    request_dir = output_dir / "requests"
    response_dir.mkdir()
    parsed_dir.mkdir()
    request_dir.mkdir()
    started_at = datetime.now(timezone.utc)
    started = started_at.isoformat()
    source_hashes = {
        "cases_sha256": _sha256(cases_path),
        "answer_key_sha256": _sha256(answers_path),
        "system_prompt_sha256": _sha256(prompt_path),
    }
    manifest = {
        "schema_version": "ai-cost-lens-model-route-run/1.0",
        "experiment_id": experiment_id,
        "route": route,
        "model": config["model"],
        "endpoint": ENDPOINT,
        "status": "running",
        "planned_request_count": len(cases),
        "completed_request_count": 0,
        "automatic_retries": 0,
        "max_output_tokens_per_request": MAX_OUTPUT_TOKENS,
        "store": False,
        "started_at": started,
        "source_hashes": source_hashes,
    }
    _write_json(output_dir / "run-manifest.json", manifest)
    results = []
    for case in cases:
        case_id = case["case_id"]
        payload = _payload(config["model"], prompt, case)
        try:
            _write_json(request_dir / f"{case_id}.json", payload)
            response = transport(payload, key)
            _write_json(response_dir / f"{case_id}.json", response)
            output = json.loads(_output_text(response))
            if not isinstance(output, dict):
                raise ModelRoutePilotError(f"{case_id} output was not a JSON object")
            _write_json(parsed_dir / f"{case_id}.json", output)
            score = score_output(output, case_id, answers[case_id])
            score["response_id"] = response.get("id")
            score["usage"] = response.get("usage")
            results.append(score)
            manifest["completed_request_count"] = len(results)
            _write_json(output_dir / "run-manifest.json", manifest)
        except json.JSONDecodeError as exc:
            failure = ModelRoutePilotError(
                f"{case_id} returned text that was not valid JSON"
            )
            _record_failure(output_dir, manifest, case_id, failure, key)
            raise failure from exc
        except ModelRoutePilotError as exc:
            _record_failure(output_dir, manifest, case_id, exc, key)
            raise
        except Exception as exc:
            failure = ModelRoutePilotError(
                f"{case_id} failed before a complete response was recorded: {exc}"
            )
            _record_failure(output_dir, manifest, case_id, failure, key)
            raise failure from exc

    completed = datetime.now(timezone.utc).isoformat()
    summary = {
        "schema_version": "ai-cost-lens-model-route-result/1.0",
        "experiment_id": experiment_id,
        "route": route,
        "model": config["model"],
        "request_count": len(results),
        "automatic_pass_count": sum(1 for item in results if item["auto_pass"]),
        "automatic_pass_rate": sum(1 for item in results if item["auto_pass"])
        / len(results),
        "automatic_scoring_is_not_human_acceptance": True,
        "automatic_retries": 0,
        "started_at": started,
        "completed_at": completed,
        "source_hashes": source_hashes,
        "results": results,
    }
    _write_json(output_dir / "summary.json", summary)
    _write_human_review_template(
        output_dir / "human-review-template.csv",
        results,
        started_at.date().isoformat(),
    )
    manifest["status"] = "completed"
    manifest["completed_request_count"] = len(results)
    manifest["completed_at"] = completed
    _write_json(output_dir / "run-manifest.json", manifest)
    return summary


def _record_failure(
    output_dir: Path,
    manifest: dict[str, Any],
    case_id: str,
    error: Exception,
    key: str,
) -> None:
    failed_at = datetime.now(timezone.utc).isoformat()
    safe_message = str(error).replace(key, "[REDACTED]")
    failure = {
        "schema_version": "ai-cost-lens-model-route-failure/1.0",
        "experiment_id": manifest["experiment_id"],
        "route": manifest["route"],
        "model": manifest["model"],
        "failed_case_id": case_id,
        "completed_request_count": manifest["completed_request_count"],
        "automatic_retries": 0,
        "failed_at": failed_at,
        "error_type": type(error).__name__,
        "error": safe_message,
    }
    _write_json(output_dir / "failure.json", failure)
    manifest["status"] = "failed"
    manifest["failed_case_id"] = case_id
    manifest["failed_at"] = failed_at
    _write_json(output_dir / "run-manifest.json", manifest)
