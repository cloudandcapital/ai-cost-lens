"""Strict AI usage contract and price-book calculations."""

from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Mapping

USAGE_VERSION = "ai-cost-lens/2.0"
MONEY = Decimal("0.000001")
REQUIRED_COLUMNS = (
    "usage_id",
    "date",
    "provider",
    "model",
    "currency",
    "uncached_input_tokens",
    "cached_input_tokens",
    "output_tokens",
    "reasoning_tokens",
    "requests",
    "batch_multiplier",
    "billed_cost",
    "cost_basis",
    "project",
    "team",
    "environment",
    "task",
)


class CanonicalError(ValueError):
    pass


def decimal(value: Any, field: str, *, allow_blank: bool = False) -> Decimal | None:
    if value is None or str(value).strip() == "":
        if allow_blank:
            return None
        raise CanonicalError(f"{field} is required")
    if isinstance(value, bool):
        raise CanonicalError(f"{field} must be numeric")
    try:
        parsed = Decimal(str(value).strip())
    except (InvalidOperation, ValueError) as exc:
        raise CanonicalError(f"{field} must be numeric") from exc
    if not parsed.is_finite() or parsed < 0:
        raise CanonicalError(f"{field} must be finite and non-negative")
    return parsed


def integer(value: Any, field: str) -> int:
    parsed = decimal(value, field)
    assert parsed is not None
    if parsed != parsed.to_integral_value():
        raise CanonicalError(f"{field} must be an integer")
    return int(parsed)


def text(value: Any, field: str) -> str:
    result = str(value or "").strip()
    if not result:
        raise CanonicalError(f"{field} is required")
    return result


@dataclass(frozen=True)
class UsageRecord:
    usage_id: str
    day: date
    provider: str
    model: str
    currency: str
    uncached_input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    reasoning_tokens: int
    requests: int
    batch_multiplier: Decimal
    billed_cost: Decimal | None
    cost_basis: str
    project: str
    team: str
    environment: str
    task: str


@dataclass(frozen=True)
class PricedUsage:
    record: UsageRecord
    cost: Decimal
    basis: str
    formula: str | None
    price_key: str | None


def load_usage(path: Path) -> tuple[list[UsageRecord], str]:
    try:
        raw = path.read_bytes()
        rows_text = raw.decode("utf-8-sig")
    except FileNotFoundError as exc:
        raise CanonicalError(f"usage file not found: {path}") from exc
    except (OSError, UnicodeError) as exc:
        raise CanonicalError(f"unable to read usage file: {exc}") from exc
    reader = csv.DictReader(rows_text.splitlines())
    if reader.fieldnames is None:
        raise CanonicalError("usage CSV is empty or missing a header")
    missing = [name for name in REQUIRED_COLUMNS if name not in reader.fieldnames]
    if missing:
        raise CanonicalError(f"missing required columns: {', '.join(missing)}")
    records = []
    seen = set()
    for row_number, row in enumerate(reader, start=2):
        usage_id = text(row.get("usage_id"), f"row {row_number} usage_id")
        if usage_id in seen:
            raise CanonicalError(f"duplicate usage_id: {usage_id}")
        seen.add(usage_id)
        try:
            day = date.fromisoformat(text(row.get("date"), f"row {row_number} date"))
        except ValueError as exc:
            raise CanonicalError(
                f"row {row_number} date must be ISO YYYY-MM-DD"
            ) from exc
        currency = text(row.get("currency"), f"row {row_number} currency").upper()
        if len(currency) != 3 or not currency.isalpha():
            raise CanonicalError(
                f"row {row_number} currency must be a three-letter ISO code"
            )
        basis = text(row.get("cost_basis"), f"row {row_number} cost_basis").lower()
        if basis not in {"provider_reported", "calculated"}:
            raise CanonicalError(f"row {row_number} cost_basis is unsupported")
        billed = decimal(
            row.get("billed_cost"), f"row {row_number} billed_cost", allow_blank=True
        )
        if basis == "provider_reported" and billed is None:
            raise CanonicalError(
                f"row {row_number} billed_cost is required for {basis}"
            )
        if basis == "calculated" and billed is not None:
            raise CanonicalError(
                f"row {row_number} billed_cost must be blank when cost_basis=calculated"
            )
        multiplier = decimal(
            row.get("batch_multiplier"), f"row {row_number} batch_multiplier"
        )
        assert multiplier is not None
        if multiplier <= 0:
            raise CanonicalError(
                f"row {row_number} batch_multiplier must be greater than zero"
            )
        records.append(
            UsageRecord(
                usage_id,
                day,
                text(row.get("provider"), f"row {row_number} provider").lower(),
                text(row.get("model"), f"row {row_number} model"),
                currency,
                integer(
                    row.get("uncached_input_tokens"),
                    f"row {row_number} uncached_input_tokens",
                ),
                integer(
                    row.get("cached_input_tokens"),
                    f"row {row_number} cached_input_tokens",
                ),
                integer(row.get("output_tokens"), f"row {row_number} output_tokens"),
                integer(
                    row.get("reasoning_tokens"), f"row {row_number} reasoning_tokens"
                ),
                integer(row.get("requests"), f"row {row_number} requests"),
                multiplier,
                billed,
                basis,
                text(row.get("project"), f"row {row_number} project"),
                text(row.get("team"), f"row {row_number} team"),
                text(row.get("environment"), f"row {row_number} environment"),
                text(row.get("task"), f"row {row_number} task"),
            )
        )
    if not records:
        raise CanonicalError("usage CSV contains no records")
    if len({record.currency for record in records}) != 1:
        raise CanonicalError("one canonical result cannot mix currencies")
    return records, hashlib.sha256(raw).hexdigest()


def load_price_book(path: Path | None) -> tuple[dict[str, Any] | None, str | None]:
    if path is None:
        return None, None
    try:
        raw = path.read_bytes()
        value = json.loads(raw)
    except FileNotFoundError as exc:
        raise CanonicalError(f"price book not found: {path}") from exc
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CanonicalError(f"unable to read price book: {exc}") from exc
    if (
        not isinstance(value, dict)
        or value.get("schema_version") != "ai-cost-lens-price-book/1.0"
        or not isinstance(value.get("prices"), dict)
    ):
        raise CanonicalError(
            "price book must use ai-cost-lens-price-book/1.0 with a prices object"
        )
    text(value.get("source"), "price book source")
    mode = text(value.get("mode"), "price book mode").lower()
    if mode not in {"illustrative", "real"}:
        raise CanonicalError("price book mode must be illustrative or real")
    value["mode"] = mode
    try:
        date.fromisoformat(text(value.get("effective_at"), "price book effective_at"))
    except ValueError as exc:
        raise CanonicalError("price book effective_at must be ISO YYYY-MM-DD") from exc
    return value, hashlib.sha256(raw).hexdigest()


def validate_price_book_mode(
    price_book: Mapping[str, Any] | None, analysis_mode: str
) -> None:
    """Require supplied pricing to match the declared analysis mode."""
    if price_book is None:
        return
    price_book_mode = str(price_book["mode"])
    if price_book_mode != analysis_mode:
        raise CanonicalError(
            f"price book mode {price_book_mode!r} cannot be used for "
            f"{analysis_mode!r} analysis; supply a price book marked "
            f"{analysis_mode!r}"
        )


def price_usage(
    records: list[UsageRecord], price_book: Mapping[str, Any] | None
) -> list[PricedUsage]:
    priced = []
    for record in records:
        if record.cost_basis != "calculated":
            assert record.billed_cost is not None
            priced.append(
                PricedUsage(record, record.billed_cost, "observed", None, None)
            )
            continue
        if price_book is None:
            raise CanonicalError(f"usage {record.usage_id} requires a price book")
        key = f"{record.provider}/{record.model}"
        effective_at = date.fromisoformat(str(price_book["effective_at"]))
        if record.day < effective_at:
            raise CanonicalError(
                f"usage {record.usage_id} predates price book effective_at; historical rates are required"
            )
        entry = price_book["prices"].get(key)
        if not isinstance(entry, Mapping):
            raise CanonicalError(
                f"unsupported calculated model: {key}; no zero-cost fallback is allowed"
            )
        if (
            text(entry.get("currency"), f"price {key} currency").upper()
            != record.currency
        ):
            raise CanonicalError(f"price currency mismatch for {key}")
        rates = {
            name: decimal(entry.get(name), f"price {key} {name}")
            for name in (
                "input_per_million",
                "cached_input_per_million",
                "output_per_million",
                "reasoning_per_million",
            )
        }
        million = Decimal("1000000")
        cost = (
            (
                Decimal(record.uncached_input_tokens) * rates["input_per_million"]
                + Decimal(record.cached_input_tokens)
                * rates["cached_input_per_million"]
                + Decimal(record.output_tokens) * rates["output_per_million"]
                + Decimal(record.reasoning_tokens) * rates["reasoning_per_million"]
            )
            / million
        ) * record.batch_multiplier
        priced.append(
            PricedUsage(
                record,
                cost,
                "calculated",
                "((uncached_input_tokens*input_rate)+(cached_input_tokens*cached_rate)+(output_tokens*output_rate)+(reasoning_tokens*reasoning_rate))/1,000,000*batch_multiplier",
                key,
            )
        )
    return priced


def cost_number(value: Decimal) -> float:
    return float(value.quantize(MONEY, rounding=ROUND_HALF_UP))
