"""Create a shareable copy of saved OpenAI organization API responses."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable, Mapping


class OpenAISanitizeError(ValueError):
    """Raised when an OpenAI response bundle cannot be sanitized safely."""


IDENTIFIER_FIELDS = {
    "project_id": "project",
    "api_key_id": "api-key",
    "user_id": "user",
    "organization_id": "organization",
}


def _load(path: Path, label: str) -> tuple[Any, bytes]:
    try:
        raw = path.read_bytes()
        value = json.loads(raw)
    except FileNotFoundError as exc:
        raise OpenAISanitizeError(f"{label} file not found: {path}") from exc
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise OpenAISanitizeError(f"unable to read {label} file: {exc}") from exc
    pages = value if isinstance(value, list) else [value]
    if not pages or not all(isinstance(page, dict) for page in pages):
        raise OpenAISanitizeError(
            f"{label} file must contain an API page object or an array of page objects"
        )
    for index, page in enumerate(pages, start=1):
        if page.get("object") != "page" or not isinstance(page.get("data"), list):
            raise OpenAISanitizeError(
                f"{label} page {index} must be an OpenAI page with a data array"
            )
    return value, raw


def _walk(value: Any) -> Iterable[Mapping[str, Any]]:
    if isinstance(value, Mapping):
        yield value
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def _identifier_maps(values: Iterable[Any]) -> dict[str, dict[str, str]]:
    found = {field: set() for field in IDENTIFIER_FIELDS}
    for value in values:
        for record in _walk(value):
            for field in IDENTIFIER_FIELDS:
                identifier = record.get(field)
                if isinstance(identifier, str) and identifier.strip():
                    found[field].add(identifier)
    return {
        field: {
            original: f"{IDENTIFIER_FIELDS[field]}-{index:03d}"
            for index, original in enumerate(sorted(originals), start=1)
        }
        for field, originals in found.items()
    }


def _sanitize(value: Any, maps: Mapping[str, Mapping[str, str]]) -> tuple[Any, int]:
    output = deepcopy(value)
    replacements = 0
    page_cursor = 0
    for record in _walk(output):
        for field, mapping in maps.items():
            current = record.get(field)
            if isinstance(current, str) and current in mapping:
                record[field] = mapping[current]
                replacements += 1
        cursor = record.get("next_page")
        if isinstance(cursor, str) and cursor:
            page_cursor += 1
            record["next_page"] = f"page-{page_cursor:03d}"
            replacements += 1
    return output, replacements


def sanitize_openai_bundle(
    usage_path: Path, cost_path: Path, output_dir: Path
) -> dict[str, Any]:
    """Sanitize two saved API response files with one stable identifier map."""
    if output_dir.exists():
        raise OpenAISanitizeError(f"output directory already exists: {output_dir}")
    usage, usage_raw = _load(usage_path, "usage")
    costs, costs_raw = _load(cost_path, "cost")
    maps = _identifier_maps((usage, costs))
    safe_usage, usage_replacements = _sanitize(usage, maps)
    safe_costs, cost_replacements = _sanitize(costs, maps)

    output_dir.mkdir(parents=True)
    usage_output = output_dir / "openai-usage.sanitized.json"
    cost_output = output_dir / "openai-costs.sanitized.json"
    usage_bytes = (json.dumps(safe_usage, indent=2, sort_keys=True) + "\n").encode()
    cost_bytes = (json.dumps(safe_costs, indent=2, sort_keys=True) + "\n").encode()
    usage_output.write_bytes(usage_bytes)
    cost_output.write_bytes(cost_bytes)

    report = {
        "schema_version": "ai-cost-lens-sanitization-report/1.0",
        "sanitized_fields": sorted(IDENTIFIER_FIELDS) + ["next_page"],
        "preserved_financial_fields": [
            "amount",
            "currency",
            "date buckets",
            "line_item",
            "model",
            "request counts",
            "token counts",
        ],
        "identifier_cardinality": {
            field: len(mapping) for field, mapping in maps.items()
        },
        "replacement_count": usage_replacements + cost_replacements,
        "inputs": {
            "usage_sha256": hashlib.sha256(usage_raw).hexdigest(),
            "cost_sha256": hashlib.sha256(costs_raw).hexdigest(),
        },
        "outputs": {
            "usage_file": usage_output.name,
            "usage_sha256": hashlib.sha256(usage_bytes).hexdigest(),
            "cost_file": cost_output.name,
            "cost_sha256": hashlib.sha256(cost_bytes).hexdigest(),
        },
    }
    (output_dir / "sanitization-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return report
