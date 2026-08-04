"""
Auto-detect AI billing CSV provider and normalize to FOCUS 1.0 records.

Detection uses column-name signatures first, then peeks at model-name values
when the column schema alone is ambiguous (OpenAI vs Anthropic share the same
column names but have distinctive model prefixes).
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Iterator, List

OPENAI_MODEL_PREFIXES = (
    "gpt-",
    "o1",
    "o3",
    "text-embedding",
    "whisper",
    "dall-e",
    "tts-",
)
ANTHROPIC_MODEL_PREFIXES = ("claude-",)
BEDROCK_MODEL_PATTERNS = (
    "amazon.",
    "anthropic.",
    "meta.",
    "ai21.",
    "cohere.",
    "mistral.",
    "amazon.nova",
)


@dataclass(frozen=True)
class FocusRecord:
    BilledCost: str
    ResourceId: str
    ServiceName: str
    ChargePeriodStart: str
    ChargePeriodEnd: str
    ChargeType: str
    provider: str
    currency: str
    input_tokens: str
    output_tokens: str
    requests: str

    def as_dict(self) -> dict:
        return {
            "BilledCost": self.BilledCost,
            "ResourceId": self.ResourceId,
            "ServiceName": self.ServiceName,
            "ChargePeriodStart": self.ChargePeriodStart,
            "ChargePeriodEnd": self.ChargePeriodEnd,
            "ChargeType": self.ChargeType,
            "provider": self.provider,
            "currency": self.currency,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "requests": self.requests,
        }


FOCUS_FIELDNAMES = list(FocusRecord.__dataclass_fields__.keys())


def detect_provider(columns: set[str], sample_model: str = "") -> str:
    """Return 'openai', 'anthropic', or 'bedrock'. Raises ValueError if undetectable."""
    if "model_id" in columns:
        return "bedrock"

    if "model" in columns:
        m = sample_model.lower()
        if any(m.startswith(p) for p in OPENAI_MODEL_PREFIXES):
            return "openai"
        if any(m.startswith(p) for p in ANTHROPIC_MODEL_PREFIXES):
            return "anthropic"
        if any(p in m for p in BEDROCK_MODEL_PATTERNS):
            return "bedrock"
        # Fall back on column set: both OpenAI and Anthropic share the same columns;
        # if we can't tell from model values, raise a helpful error.
        raise ValueError(
            f"Column set is ambiguous (model='{sample_model}'). "
            "Ensure the CSV contains model names starting with 'gpt-'/'o1' (OpenAI), "
            "'claude-' (Anthropic), or use model_id column for Bedrock."
        )

    raise ValueError(
        f"Cannot detect provider from columns: {sorted(columns)}. "
        "Expected a 'model' column (OpenAI/Anthropic) or 'model_id' column (Bedrock)."
    )


def load_and_normalize(path: Path) -> List[FocusRecord]:
    """Read a billing CSV, auto-detect provider, return normalized FOCUS records."""
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None:
            raise ValueError(f"CSV file is empty or missing a header row: {path}")
        columns = set(reader.fieldnames)

        rows = list(reader)

    if not rows:
        raise ValueError(f"CSV file contains no usage rows: {path}")

    sample_model = ""
    model_col = (
        "model_id" if "model_id" in columns else "model" if "model" in columns else ""
    )
    if model_col and rows:
        sample_model = (rows[0].get(model_col) or "").strip().lower()

    provider = detect_provider(columns, sample_model)
    if model_col:
        for index, row in enumerate(rows, start=2):
            model_value = (row.get(model_col) or "").strip().lower()
            if not model_value:
                raise ValueError(f"Row {index}: model is required")
            row_provider = detect_provider(columns, model_value)
            if row_provider != provider:
                raise ValueError(
                    f"Row {index}: mixed provider-shaped rows are not supported by the legacy adapter"
                )

    if provider == "openai":
        return list(_normalize_openai(rows))
    if provider == "anthropic":
        return list(_normalize_anthropic(rows))
    return list(_normalize_bedrock(rows))


def _next_day(date_str: str) -> str:
    try:
        d = date.fromisoformat(date_str[:10])
        return (d + timedelta(days=1)).isoformat()
    except Exception:
        return ""


def _normalize_openai(rows: list[dict]) -> Iterator[FocusRecord]:
    for row in rows:
        date_val = row.get("date") or row.get("Date") or ""
        model = row.get("model") or row.get("Model") or ""
        cost = row.get("cost_usd") or row.get("Cost (USD)") or row.get("cost") or ""
        input_tokens = row.get("input_tokens") or row.get("Input tokens") or ""
        output_tokens = row.get("output_tokens") or row.get("Output tokens") or ""
        requests = row.get("requests") or row.get("Requests") or ""
        yield FocusRecord(
            BilledCost=cost,
            ResourceId="",
            ServiceName=model,
            ChargePeriodStart=date_val[:10] if date_val else "",
            ChargePeriodEnd=_next_day(date_val) if date_val else "",
            ChargeType="Usage",
            provider="openai",
            currency="USD",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            requests=requests,
        )


def _normalize_anthropic(rows: list[dict]) -> Iterator[FocusRecord]:
    for row in rows:
        date_val = row.get("date") or row.get("Date") or ""
        model = row.get("model") or row.get("Model") or ""
        cost = row.get("cost_usd") or row.get("Cost (USD)") or row.get("cost") or ""
        input_tokens = row.get("input_tokens") or row.get("Input tokens") or ""
        output_tokens = row.get("output_tokens") or row.get("Output tokens") or ""
        requests = row.get("requests") or row.get("Requests") or ""
        yield FocusRecord(
            BilledCost=cost,
            ResourceId="",
            ServiceName=model,
            ChargePeriodStart=date_val[:10] if date_val else "",
            ChargePeriodEnd=_next_day(date_val) if date_val else "",
            ChargeType="Usage",
            provider="anthropic",
            currency="USD",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            requests=requests,
        )


def _normalize_bedrock(rows: list[dict]) -> Iterator[FocusRecord]:
    for row in rows:
        date_val = row.get("date") or row.get("Date") or ""
        model = row.get("model_id") or row.get("model") or ""
        cost = row.get("cost_usd") or row.get("Cost (USD)") or row.get("cost") or ""
        input_tokens = row.get("input_tokens") or row.get("Input tokens") or ""
        output_tokens = row.get("output_tokens") or row.get("Output tokens") or ""
        requests = row.get("requests") or row.get("Requests") or ""
        yield FocusRecord(
            BilledCost=cost,
            ResourceId="",
            ServiceName=model,
            ChargePeriodStart=date_val[:10] if date_val else "",
            ChargePeriodEnd=_next_day(date_val) if date_val else "",
            ChargeType="Usage",
            provider="bedrock",
            currency="USD",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            requests=requests,
        )
