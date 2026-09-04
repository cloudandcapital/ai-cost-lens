from __future__ import annotations

import copy
import csv
import json
import os
import subprocess
import sys
from decimal import Decimal
from pathlib import Path

import pytest
from click.testing import CliRunner

from ai_cost_lens.canonical import (
    REQUIRED_COLUMNS,
    CanonicalError,
    load_price_book,
    load_usage,
)
from ai_cost_lens.ccac import build_result
from ai_cost_lens.cli import cli

DATA_DIR = Path(__file__).parents[1] / "ai_cost_lens" / "data"


def _demo_1_1() -> dict:
    result = CliRunner().invoke(cli, ["ccac", "--demo", "--contract-version", "1.1.0"])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def _scope(payload: dict) -> dict:
    scopes = [
        metric
        for metric in payload["metrics"]
        if metric.get("accounting_boundary", {}).get("relationship")
        == "canonical_scope_spend"
    ]
    assert len(scopes) == 1
    return scopes[0]


def _assert_scope_reconciles(payload: dict) -> None:
    scope = _scope(payload)
    by_id = {metric["id"]: metric for metric in payload["metrics"]}
    component_sum = sum(
        Decimal(str(by_id[metric_id]["value"]))
        for metric_id in scope["input_metric_ids"]
    )
    assert Decimal(str(scope["value"])) == component_sum


def _copy_1_1_inputs(tmp_path: Path) -> tuple[Path, Path, Path]:
    usage = tmp_path / "usage.csv"
    prices = tmp_path / "prices.json"
    analysis = tmp_path / "analysis.json"
    usage.write_bytes((DATA_DIR / "canonical-usage-v2.1.csv").read_bytes())
    prices.write_bytes((DATA_DIR / "illustrative-price-book-v1.1.json").read_bytes())
    analysis.write_bytes((DATA_DIR / "illustrative-analysis-v1.json").read_bytes())
    return usage, prices, analysis


def _build_1_1(
    usage: Path,
    prices: Path | None,
    analysis: Path | None,
    *,
    mode: str = "illustrative",
) -> dict:
    return build_result(
        usage,
        price_book_path=prices,
        analysis_path=analysis,
        mode=mode,
        contract_version="1.1.0",
        run_id="123e4567-e89b-12d3-a456-426614174030",
        generated_at="2026-08-04T12:15:00Z",
    )


def _rewrite_csv(path: Path, mutate) -> None:
    with path.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
        header = list(rows[0])
    mutate(rows)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=header)
        writer.writeheader()
        writer.writerows(rows)


def _rewrite_json(path: Path, mutate) -> None:
    payload = json.loads(path.read_text())
    mutate(payload)
    path.write_text(json.dumps(payload))


def _make_real_declarations(prices: Path, analysis: Path) -> None:
    _rewrite_json(prices, lambda payload: payload.__setitem__("mode", "real"))
    _rewrite_json(
        analysis,
        lambda payload: (
            payload.__setitem__("mode", "real"),
            payload.__setitem__(
                "completeness",
                {
                    "status": "partial",
                    "absent_dates": "unknown",
                    "description": "Local files do not establish complete vendor or period coverage.",
                },
            ),
        ),
    )


def _write_price_book(tmp_path: Path, mode: str | None, *, model: str = "m") -> Path:
    payload = {
        "schema_version": "ai-cost-lens-price-book/1.0",
        "effective_at": "2026-07-01",
        "source": "Test rates",
        "prices": {
            f"openai/{model}": {
                "currency": "USD",
                "input_per_million": 2,
                "cached_input_per_million": 1,
                "output_per_million": 4,
                "reasoning_per_million": 4,
            }
        },
    }
    if mode is not None:
        payload["mode"] = mode
    path = tmp_path / f"prices-{mode or 'missing'}.json"
    path.write_text(json.dumps(payload))
    return path


def _write_usage(
    tmp_path: Path, rows: list[list[str]], name: str = "usage.csv"
) -> Path:
    path = tmp_path / name
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(REQUIRED_COLUMNS)
        writer.writerows(rows)
    return path


def _usage_row(
    usage_id: str, cost_basis: str, billed_cost: str, *, tokens: str = "1000000"
) -> list[str]:
    return [
        usage_id,
        "2026-07-01",
        "openai",
        "m",
        "USD",
        tokens,
        "0",
        "0",
        "0",
        "1",
        "1",
        billed_cost,
        cost_basis,
        "same-project",
        "same-team",
        "production",
        "same-task",
    ]


def test_demo_is_deterministic_reconciled_and_explicitly_illustrative():
    runner = CliRunner()
    first = runner.invoke(cli, ["ccac", "--demo"])
    second = runner.invoke(cli, ["ccac", "--demo"])
    assert first.exit_code == 0, first.output
    assert first.output == second.output
    payload = json.loads(first.output)
    assert payload["contract"] == "ccac/1.0.0"
    assert payload["producer"] == {"name": "ai-cost-lens", "version": "0.2.0"}
    assert payload["mode"] == "illustrative"
    assert payload["extensions"]["ai_cost_lens"]["reconciliation"]["status"] == "passed"
    assert payload["opportunities"] == []
    assert all("--" not in metric["id"] for metric in payload["metrics"])


def test_default_and_explicit_1_0_are_byte_identical():
    runner = CliRunner()
    default = runner.invoke(cli, ["ccac", "--demo"])
    explicit = runner.invoke(cli, ["ccac", "--demo", "--contract-version", "1.0.0"])
    assert default.exit_code == explicit.exit_code == 0
    assert default.output == explicit.output
    assert json.loads(default.output)["producer"]["version"] == "0.2.0"


def test_real_local_1_0_reports_current_producer_and_adapter(tmp_path: Path):
    prices = tmp_path / "real-prices.json"
    payload = json.loads((DATA_DIR / "illustrative-price-book.json").read_text())
    payload["mode"] = "real"
    prices.write_text(json.dumps(payload))
    result = build_result(
        DATA_DIR / "canonical-usage-v2.csv",
        price_book_path=prices,
        mode="real",
        contract_version="1.0.0",
    )
    assert result["producer"]["version"] == "0.3.2"
    assert {source["adapter_version"] for source in result["inputs"]} == {"0.3.2"}


def test_custom_illustrative_1_0_cannot_impersonate_legacy_demo(tmp_path: Path):
    usage = tmp_path / "custom.csv"
    usage.write_text((DATA_DIR / "canonical-usage-v2.csv").read_text())
    usage.write_text(usage.read_text().replace("usage-001", "custom-usage"))
    result = build_result(
        usage,
        price_book_path=DATA_DIR / "illustrative-price-book.json",
        mode="illustrative",
        contract_version="1.0.0",
        compatibility_demo=True,
    )
    assert result["producer"]["version"] == "0.3.2"
    assert {source["adapter_version"] for source in result["inputs"]} == {"0.3.2"}


def test_1_1_emits_one_canonical_direct_ai_scope_with_exact_components():
    payload = _demo_1_1()
    scope = _scope(payload)
    boundary = scope["accounting_boundary"]
    assert payload["contract"] == "ccac/1.1.0"
    assert payload["producer"] == {"name": "ai-cost-lens", "version": "0.3.2"}
    assert (scope["id"], scope["value"], scope["currency"]) == (
        "metric.tech-spend.scope.direct_ai",
        8.2825,
        "USD",
    )
    assert (scope["basis"], scope["additivity"]) == ("calculated", "additive")
    assert boundary == {
        "relationship": "canonical_scope_spend",
        "scope": "direct_ai",
        "canonical_owner": "ai-cost-lens",
        "source_channel": "direct_ai_vendor",
        "cost_basis": "net_cost",
        "currency_minor_unit": 0.01,
        "inclusion_rules": [
            "Include usage explicitly classified as direct_ai_vendor billing."
        ],
        "exclusion_rules": [
            "Exclude provider-billed native AI assigned to cloud_provider_billing.",
            "Exclude SaaS invoice or entitlement charges outside direct AI-vendor billing.",
        ],
        "coverage": "complete",
        "overlap": {
            "disposition": "resolved",
            "treatment": "Explicit billing-channel declarations exclude provider-billed AI from direct_ai.",
        },
        "cross_scope_treatments": {
            "provider_billed_ai": "excluded",
            "direct_ai_vendor": "included",
        },
        "component_treatments": {
            "credits": "not_applicable",
            "taxes": "not_applicable",
            "adjustments": "not_applicable",
            "shared_services": "not_applicable",
        },
        "allocation_of_metric_id": None,
        "total_eligible": True,
        "eligibility_reason": "Eligible only for the complete deterministic illustrative window declared by the bundled fixture.",
    }
    components = {
        metric["id"]: metric
        for metric in payload["metrics"]
        if metric["id"] in scope["input_metric_ids"]
    }
    assert set(components) == set(scope["input_metric_ids"])
    assert len(components) == 3
    assert {metric["dimensions"]["provider"] for metric in components.values()} == {
        "openai",
        "anthropic",
    }
    assert sum(
        Decimal(str(metric["value"])) for metric in components.values()
    ) == Decimal("8.2825")
    assert scope["dimensions"]["component_bases"] == "calculated"


def test_demo_billing_providers_are_explicit_and_separate_from_model_provider():
    payload = _demo_1_1()
    pairs = {
        (
            metric["dimensions"].get("provider"),
            metric["dimensions"].get("billing_provider"),
            metric["dimensions"].get("billing_channel"),
        )
        for metric in payload["metrics"]
        if metric["unit"] == "currency" and metric["id"].endswith(".cost")
    }
    assert ("openai", "openai", "direct_ai_vendor") in pairs
    assert ("anthropic", "anthropic", "direct_ai_vendor") in pairs
    assert ("bedrock", "aws", "cloud_provider_billing") in pairs


def test_1_1_excludes_bedrock_and_preserves_ai_domain_total():
    payload = _demo_1_1()
    scope = _scope(payload)
    bedrock = [
        metric
        for metric in payload["metrics"]
        if metric["unit"] == "currency"
        and metric["dimensions"].get("provider") == "bedrock"
        and metric["id"].endswith(".cost")
    ]
    assert len(bedrock) == 1 and bedrock[0]["value"] == 4.25
    assert bedrock[0]["id"] not in scope["input_metric_ids"]
    assert (
        next(
            metric
            for metric in payload["metrics"]
            if metric["id"] == "metric.ai.total-cost"
        )["value"]
        == 12.5325
    )
    assert (
        payload["extensions"]["ai_cost_lens"]["direct_ai_scope"][
            "excluded_provider_billed_cost"
        ]
        == 4.25
    )
    _assert_scope_reconciles(payload)


def test_bedrock_contaminated_scope_fails_focused_reconciliation():
    payload = _demo_1_1()
    _scope(payload)["value"] = 12.5325
    with pytest.raises(AssertionError):
        _assert_scope_reconciles(payload)


def test_1_1_period_and_complete_illustrative_evidence_are_truthful():
    payload = _demo_1_1()
    scope = _scope(payload)
    expected = {"start": "2026-07-01", "end": "2026-07-22", "timezone": "UTC"}
    assert payload["period"] == scope["period"] == expected
    completeness = payload["extensions"]["ai_cost_lens"]["direct_ai_scope"][
        "completeness"
    ]
    assert completeness["status"] == "complete"
    assert completeness["absent_dates"] == "zero_illustrative_usage"
    evidence_text = " ".join(item["description"] for item in payload["evidence"])
    assert "Deterministic public scenario" in evidence_text
    assert "Synthetic, non-current" in evidence_text
    assert "no customer account" in evidence_text
    assert "provider API" in evidence_text
    assert "no invoice was fetched or certified" in evidence_text


@pytest.mark.parametrize("value", ["", "unknown", "saas_invoice_or_entitlement"])
def test_1_1_missing_invalid_or_contradictory_billing_channel_fails(
    tmp_path: Path, value: str
):
    usage, prices, analysis = _copy_1_1_inputs(tmp_path)
    _rewrite_csv(usage, lambda rows: rows[0].__setitem__("billing_channel", value))
    with pytest.raises(CanonicalError, match="billing_channel"):
        _build_1_1(usage, prices, analysis)


def test_1_1_provider_name_does_not_supply_missing_classification(tmp_path: Path):
    usage, prices, analysis = _copy_1_1_inputs(tmp_path)
    _rewrite_csv(usage, lambda rows: rows[0].__setitem__("billing_channel", ""))
    with pytest.raises(CanonicalError, match="billing_channel"):
        _build_1_1(usage, prices, analysis)


def test_1_1_missing_billing_provider_fails(tmp_path: Path):
    usage, prices, analysis = _copy_1_1_inputs(tmp_path)
    _rewrite_csv(usage, lambda rows: rows[0].__setitem__("billing_provider", ""))
    with pytest.raises(CanonicalError, match="billing_provider"):
        _build_1_1(usage, prices, analysis)


@pytest.mark.parametrize(
    "model_provider,billing_provider,row_index",
    [("openai", "azure", 0), ("anthropic", "aws", 1)],
)
def test_model_provider_can_be_billed_through_cloud(
    tmp_path: Path, model_provider: str, billing_provider: str, row_index: int
):
    usage, prices, analysis = _copy_1_1_inputs(tmp_path)

    def mutate(rows):
        assert rows[row_index]["provider"] == model_provider
        rows[row_index]["billing_provider"] = billing_provider
        rows[row_index]["billing_channel"] = "cloud_provider_billing"

    _rewrite_csv(usage, mutate)
    payload = _build_1_1(usage, prices, analysis)
    changed = [
        metric
        for metric in payload["metrics"]
        if metric["unit"] == "currency"
        and metric["dimensions"].get("provider") == model_provider
        and metric["dimensions"].get("billing_provider") == billing_provider
        and metric["id"].endswith(".cost")
    ]
    assert changed
    assert all(
        metric["id"] not in _scope(payload)["input_metric_ids"] for metric in changed
    )


@pytest.mark.parametrize(
    "billing_provider,billing_channel",
    [
        ("aws", "direct_ai_vendor"),
        ("azure", "direct_ai_vendor"),
        ("openai", "cloud_provider_billing"),
    ],
)
def test_contradictory_billing_provenance_fails(
    tmp_path: Path, billing_provider: str, billing_channel: str
):
    usage, prices, analysis = _copy_1_1_inputs(tmp_path)

    def mutate(rows):
        rows[0]["billing_provider"] = billing_provider
        rows[0]["billing_channel"] = billing_channel

    _rewrite_csv(usage, mutate)
    with pytest.raises(CanonicalError, match="contradicts billing_channel"):
        _build_1_1(usage, prices, analysis)


def test_grouped_components_reject_conflicting_billing_provenance(tmp_path: Path):
    usage, prices, analysis = _copy_1_1_inputs(tmp_path)

    def mutate(rows):
        duplicate = dict(rows[0])
        duplicate["usage_id"] = "usage-conflict"
        duplicate["billing_provider"] = "azure"
        duplicate["billing_channel"] = "cloud_provider_billing"
        rows.append(duplicate)

    _rewrite_csv(usage, mutate)
    with pytest.raises(CanonicalError, match="conflicting billing provenance"):
        _build_1_1(usage, prices, analysis)


@pytest.mark.parametrize("value", [None, "billed_cost"])
def test_1_1_missing_or_contradictory_scope_cost_basis_fails(
    tmp_path: Path, value: str | None
):
    usage, prices, analysis = _copy_1_1_inputs(tmp_path)

    def mutate(payload):
        if value is None:
            payload.pop("accounting_cost_basis")
        else:
            payload["accounting_cost_basis"] = value

    _rewrite_json(analysis, mutate)
    with pytest.raises(CanonicalError, match="accounting_cost_basis=net_cost"):
        _build_1_1(usage, prices, analysis)


@pytest.mark.parametrize("status,absent", [(None, None), ("partial", "unknown")])
def test_1_1_eligible_illustrative_scope_requires_complete_declaration(
    tmp_path: Path, status: str | None, absent: str | None
):
    usage, prices, analysis = _copy_1_1_inputs(tmp_path)

    def mutate(payload):
        if status is None:
            payload.pop("completeness")
        else:
            payload["completeness"].update(status=status, absent_dates=absent)

    _rewrite_json(analysis, mutate)
    with pytest.raises(CanonicalError, match="completeness|complete coverage"):
        _build_1_1(usage, prices, analysis)


def test_1_1_real_local_file_remains_partial_and_ineligible(tmp_path: Path):
    usage, prices, analysis = _copy_1_1_inputs(tmp_path)
    _rewrite_json(
        prices,
        lambda payload: (payload.__setitem__("mode", "real"),),
    )
    _rewrite_json(
        analysis,
        lambda payload: (
            payload.__setitem__("mode", "real"),
            payload.__setitem__(
                "completeness",
                {
                    "status": "partial",
                    "absent_dates": "unknown",
                    "description": "Local files do not establish complete vendor or period coverage.",
                },
            ),
        ),
    )
    scope = _scope(_build_1_1(usage, prices, analysis, mode="real"))
    assert scope["value"] == 8.2825
    assert scope["accounting_boundary"]["coverage"] == "partial"
    assert scope["accounting_boundary"]["total_eligible"] is False


def test_analysis_declaration_is_separate_from_price_book():
    prices = json.loads((DATA_DIR / "illustrative-price-book-v1.1.json").read_text())
    analysis = json.loads((DATA_DIR / "illustrative-analysis-v1.json").read_text())
    assert not {
        "period",
        "scenario_period",
        "completeness",
        "scope_cost_basis",
    }.intersection(prices)
    assert analysis["schema_version"] == "ai-cost-lens-analysis/1.0"
    assert analysis["accounting_cost_basis"] == "net_cost"
    assert analysis["period"] == {
        "start": "2026-07-01",
        "end": "2026-07-22",
        "timezone": "UTC",
    }


def test_1_1_missing_analysis_declaration_fails(tmp_path: Path):
    usage, prices, _ = _copy_1_1_inputs(tmp_path)
    with pytest.raises(CanonicalError, match="analysis declaration"):
        _build_1_1(usage, prices, None)


@pytest.mark.parametrize("mutation", ["schema", "mode"])
def test_1_1_malformed_or_contradictory_analysis_fails(tmp_path: Path, mutation: str):
    usage, prices, analysis = _copy_1_1_inputs(tmp_path)
    if mutation == "schema":
        _rewrite_json(
            analysis,
            lambda payload: payload.__setitem__("schema_version", "unsupported"),
        )
        message = "ai-cost-lens-analysis/1.0"
    else:
        _rewrite_json(analysis, lambda payload: payload.__setitem__("mode", "real"))
        message = "mode contradicts"
    with pytest.raises(CanonicalError, match=message):
        _build_1_1(usage, prices, analysis)


def test_real_analysis_rejects_contradictory_absent_date_treatment(tmp_path: Path):
    usage, prices, analysis = _copy_1_1_inputs(tmp_path)
    _rewrite_json(prices, lambda payload: payload.__setitem__("mode", "real"))
    _rewrite_json(
        analysis,
        lambda payload: (
            payload.__setitem__("mode", "real"),
            payload["completeness"].update(
                status="partial", absent_dates="zero_illustrative_usage"
            ),
        ),
    )
    with pytest.raises(CanonicalError, match="unknown absent dates"):
        _build_1_1(usage, prices, analysis, mode="real")


def test_all_provider_reported_direct_scope_is_observed(tmp_path: Path):
    usage, _, analysis = _copy_1_1_inputs(tmp_path)
    reported = {"usage-001": "4.9", "usage-002": "2.1375", "usage-004": "1.245"}

    def mutate(rows):
        for row in rows:
            if row["usage_id"] in reported:
                row["cost_basis"] = "provider_reported"
                row["billed_cost"] = reported[row["usage_id"]]

    _rewrite_csv(usage, mutate)
    _rewrite_json(
        analysis,
        lambda payload: (
            payload.__setitem__("mode", "real"),
            payload.__setitem__(
                "completeness",
                {
                    "status": "partial",
                    "absent_dates": "unknown",
                    "description": "Local reported rows provide partial coverage.",
                },
            ),
        ),
    )
    payload = _build_1_1(usage, None, analysis, mode="real")
    scope = _scope(payload)
    assert (scope["value"], scope["basis"], scope["formula"]) == (
        8.2825,
        "observed",
        None,
    )
    assert scope["dimensions"]["component_bases"] == "observed"
    assert scope["evidence_ids"] == [
        "evidence.ai-cost-lens.usage",
        "evidence.ai-cost-lens.analysis",
    ]
    if os.environ.get("REQUIRE_CCAC_RELEASE_VALIDATION") == "1":
        from ccac.validator import validate_document

        assert validate_document(payload) == []


def test_mixed_direct_scope_is_calculated_with_complete_evidence(tmp_path: Path):
    usage, prices, analysis = _copy_1_1_inputs(tmp_path)

    def mutate(rows):
        rows[0]["cost_basis"] = "provider_reported"
        rows[0]["billed_cost"] = "4.9"

    _rewrite_csv(usage, mutate)
    _make_real_declarations(prices, analysis)
    payload = _build_1_1(usage, prices, analysis, mode="real")
    scope = _scope(payload)
    assert (scope["value"], scope["basis"]) == (8.2825, "calculated")
    assert scope["formula"]
    assert scope["dimensions"]["component_bases"] == "calculated,observed"
    assert scope["evidence_ids"] == [
        "evidence.ai-cost-lens.usage",
        "evidence.ai-cost-lens.analysis",
        "evidence.ai-cost-lens.price-book",
    ]
    if os.environ.get("REQUIRE_CCAC_RELEASE_VALIDATION") == "1":
        from ccac.validator import validate_document

        assert validate_document(payload) == []


def test_1_1_period_mismatch_fails(tmp_path: Path):
    usage, prices, analysis = _copy_1_1_inputs(tmp_path)
    _rewrite_csv(usage, lambda rows: rows[0].__setitem__("date", "2026-07-22"))
    with pytest.raises(CanonicalError, match="outside the declared scenario_period"):
        _build_1_1(usage, prices, analysis)


def test_1_1_mixed_currency_fails(tmp_path: Path):
    usage, prices, analysis = _copy_1_1_inputs(tmp_path)
    _rewrite_csv(usage, lambda rows: rows[0].__setitem__("currency", "EUR"))
    with pytest.raises(CanonicalError, match="mix currencies|currency mismatch"):
        _build_1_1(usage, prices, analysis)


def test_unsupported_contract_selection_fails_clearly():
    result = CliRunner().invoke(cli, ["ccac", "--demo", "--contract-version", "2.0.0"])
    assert result.exit_code == 2
    assert "Invalid value for '--contract-version'" in result.output


def test_1_1_is_byte_deterministic_and_passes_released_ccac(tmp_path: Path):
    runner = CliRunner()
    args = ["ccac", "--demo", "--contract-version", "1.1.0"]
    first = runner.invoke(cli, args)
    second = runner.invoke(cli, args)
    assert first.exit_code == second.exit_code == 0
    assert first.output == second.output
    if os.environ.get("REQUIRE_CCAC_RELEASE_VALIDATION") != "1":
        pytest.skip("released CCAC acceptance validator enabled in CI verification")
    artifact = tmp_path / "direct-ai.json"
    artifact.write_text(first.output)
    validation = subprocess.run(
        [sys.executable, "-m", "ccac.cli", "validate", str(artifact)],
        text=True,
        capture_output=True,
        check=False,
    )
    assert validation.returncode == 0, validation.stdout + validation.stderr


@pytest.mark.parametrize(
    "field,value",
    [
        ("canonical_owner", "finops-lite"),
        ("scope", "cloud"),
        ("source_channel", "cloud_provider_billing"),
    ],
)
def test_released_ccac_rejects_wrong_scope_identity(field: str, value: str):
    if os.environ.get("REQUIRE_CCAC_RELEASE_VALIDATION") != "1":
        pytest.skip("released CCAC acceptance validator enabled in CI verification")
    from ccac.validator import validate_document

    payload = _demo_1_1()
    _scope(payload)["accounting_boundary"][field] = value
    assert validate_document(payload)


def test_released_ccac_rejects_missing_evidence_and_duplicate_scope():
    if os.environ.get("REQUIRE_CCAC_RELEASE_VALIDATION") != "1":
        pytest.skip("released CCAC acceptance validator enabled in CI verification")
    from ccac.validator import validate_document

    missing = _demo_1_1()
    _scope(missing)["evidence_ids"] = []
    assert validate_document(missing)
    duplicate = _demo_1_1()
    duplicate["metrics"].append(copy.deepcopy(_scope(duplicate)))
    assert validate_document(duplicate)


def test_bedrock_overlap_and_unattributed_cost_are_explicit():
    payload = json.loads(CliRunner().invoke(cli, ["ccac", "--demo"]).output)
    bedrock = next(
        metric
        for metric in payload["metrics"]
        if metric["dimensions"].get("provider") == "bedrock"
        and metric["unit"] == "currency"
    )
    assert bedrock["dimensions"]["cloud_spend_overlap"] == "potential"
    assert (
        next(
            metric
            for metric in payload["metrics"]
            if metric["id"] == "metric.ai.total-cost"
        )["additivity"]
        == "non_additive"
    )
    assert any(
        "not a savings estimate" in finding["description"]
        for finding in payload["findings"]
    )


def test_token_categories_and_cost_bases_remain_distinct():
    payload = json.loads(CliRunner().invoke(cli, ["ccac", "--demo"]).output)
    names = {metric["name"] for metric in payload["metrics"]}
    assert {
        "Uncached input tokens",
        "Cached input tokens",
        "Output tokens",
        "Reasoning tokens",
    }.issubset(names)
    bases = {
        metric["basis"] for metric in payload["metrics"] if metric["unit"] == "currency"
    }
    assert "observed" in bases
    assert "calculated" in bases
    assert any(
        metric["id"].endswith(".cost-per-million-tokens")
        for metric in payload["metrics"]
    )
    assert any(
        metric["id"].endswith(".cost-per-request") for metric in payload["metrics"]
    )


def test_identical_dimensions_keep_cost_bases_separate_and_reconcile(tmp_path: Path):
    usage = _write_usage(
        tmp_path,
        [
            _usage_row("reported", "provider_reported", "3"),
            _usage_row("priced", "calculated", ""),
        ],
    )
    payload = build_result(
        usage, price_book_path=_write_price_book(tmp_path, "real"), mode="real"
    )
    cost_metrics = [
        metric
        for metric in payload["metrics"]
        if metric["unit"] == "currency" and metric["id"] != "metric.ai.total-cost"
    ]
    assert len(cost_metrics) == 2
    assert len({metric["id"] for metric in cost_metrics}) == 2
    by_cost_basis = {
        metric["dimensions"]["cost_basis"]: metric for metric in cost_metrics
    }
    reported = by_cost_basis["provider_reported"]
    calculated = by_cost_basis["calculated"]
    assert (reported["value"], reported["basis"], reported["evidence_ids"]) == (
        3.0,
        "observed",
        ["evidence.ai-cost-lens.usage"],
    )
    assert (calculated["value"], calculated["basis"]) == (2.0, "calculated")
    assert calculated["evidence_ids"] == [
        "evidence.ai-cost-lens.usage",
        "evidence.ai-cost-lens.price-book",
    ]
    total = next(
        metric
        for metric in payload["metrics"]
        if metric["id"] == "metric.ai.total-cost"
    )
    assert total["value"] == 5.0
    assert set(total["input_metric_ids"]) == {metric["id"] for metric in cost_metrics}
    assert total["dimensions"]["cost_basis"] == "mixed_calculated_and_provider_reported"
    assert total["evidence_ids"] == [
        "evidence.ai-cost-lens.usage",
        "evidence.ai-cost-lens.price-book",
    ]
    reconciliation = payload["extensions"]["ai_cost_lens"]["reconciliation"]
    assert reconciliation["row_cost_sum"] == 5.0
    assert reconciliation["model_cost_sum"] == 5.0
    assert reconciliation["difference"] == 0.0
    assert reconciliation["row_token_sum"] == 2_000_000
    assert reconciliation["metric_token_sum"] == 2_000_000
    assert reconciliation["token_difference"] == 0
    assert reconciliation["status"] == "passed"
    token_metrics = [
        metric
        for metric in payload["metrics"]
        if metric["name"] == "Uncached input tokens"
    ]
    assert sum(metric["value"] for metric in token_metrics) == 2_000_000


def test_demo_emits_illustrative_pricing_provenance():
    payload = json.loads(CliRunner().invoke(cli, ["ccac", "--demo"]).output)
    provenance = payload["extensions"]["ai_cost_lens"]["pricing_provenance"]
    assert provenance["mode"] == "illustrative"
    assert provenance["effective_at"] == "2026-07-01"
    assert "Synthetic rates" in provenance["source"]
    assert len(provenance["input_sha256"]) == 64
    assert provenance["used_price_keys"] == [
        "anthropic/illustrative-model-b",
        "openai/illustrative-model-a",
    ]
    assert provenance["used_rate_keys"] == [
        "cached_input_per_million",
        "input_per_million",
        "output_per_million",
        "reasoning_per_million",
    ]


@pytest.mark.parametrize("mode", [None, "invalid"])
def test_missing_or_invalid_price_book_mode_is_rejected(
    tmp_path: Path, mode: str | None
):
    with pytest.raises(CanonicalError, match="price book mode"):
        load_price_book(_write_price_book(tmp_path, mode))


@pytest.mark.parametrize(
    "analysis_mode,price_book_mode",
    [("real", "illustrative"), ("illustrative", "real")],
)
def test_price_book_mode_mismatch_is_rejected(
    tmp_path: Path, analysis_mode: str, price_book_mode: str
):
    usage = _write_usage(tmp_path, [_usage_row("priced", "calculated", "")])
    with pytest.raises(CanonicalError, match="cannot be used"):
        build_result(
            usage,
            price_book_path=_write_price_book(tmp_path, price_book_mode),
            mode=analysis_mode,
        )


@pytest.mark.parametrize("mode", ["real", "illustrative"])
def test_matching_price_book_modes_are_accepted(tmp_path: Path, mode: str):
    usage = _write_usage(tmp_path, [_usage_row("priced", "calculated", "")])
    payload = build_result(
        usage, price_book_path=_write_price_book(tmp_path, mode), mode=mode
    )
    assert payload["extensions"]["ai_cost_lens"]["pricing_provenance"]["mode"] == mode


def test_provider_reported_only_needs_no_price_book(tmp_path: Path):
    usage = _write_usage(tmp_path, [_usage_row("reported", "provider_reported", "3")])
    payload = build_result(usage, price_book_path=None, mode="real")
    assert payload["extensions"]["ai_cost_lens"]["pricing_provenance"] is None
    metric = next(
        metric
        for metric in payload["metrics"]
        if metric["unit"] == "currency" and metric["id"] != "metric.ai.total-cost"
    )
    assert metric["basis"] == "observed"
    assert metric["dimensions"]["cost_basis"] == "provider_reported"


def test_provider_reported_only_with_unused_price_book_has_empty_rate_lineage(
    tmp_path: Path,
):
    usage = _write_usage(tmp_path, [_usage_row("reported", "provider_reported", "3")])
    payload = build_result(
        usage, price_book_path=_write_price_book(tmp_path, "real"), mode="real"
    )
    provenance = payload["extensions"]["ai_cost_lens"]["pricing_provenance"]
    assert provenance["mode"] == "real"
    assert provenance["source"] == "Test rates"
    assert provenance["used_price_keys"] == []
    assert provenance["used_rate_keys"] == []
    cost = next(
        metric
        for metric in payload["metrics"]
        if metric["unit"] == "currency" and metric["id"] != "metric.ai.total-cost"
    )
    assert cost["value"] == 3.0
    assert cost["basis"] == "observed"
    assert cost["dimensions"]["cost_basis"] == "provider_reported"
    total = next(
        metric
        for metric in payload["metrics"]
        if metric["id"] == "metric.ai.total-cost"
    )
    assert total["value"] == 3.0
    assert total["evidence_ids"] == ["evidence.ai-cost-lens.usage"]
    assert total["input_metric_ids"] == [cost["id"]]
    reconciliation = payload["extensions"]["ai_cost_lens"]["reconciliation"]
    assert reconciliation["row_cost_sum"] == 3.0
    assert reconciliation["model_cost_sum"] == 3.0
    assert reconciliation["difference"] == 0.0
    assert reconciliation["status"] == "passed"


def test_calculated_usage_without_price_book_fails_closed(tmp_path: Path):
    usage = _write_usage(tmp_path, [_usage_row("priced", "calculated", "")])
    with pytest.raises(CanonicalError, match="requires a price book"):
        build_result(usage, price_book_path=None, mode="real")


def test_demo_output_file_contains_json_only(tmp_path):
    target = tmp_path / "result.json"
    result = CliRunner().invoke(cli, ["ccac", "--demo", "--output", str(target)])
    assert result.exit_code == 0
    assert result.output == ""
    assert json.loads(target.read_text())["mode"] == "illustrative"


@pytest.mark.parametrize(
    "field,value",
    [
        ("uncached_input_tokens", "NaN"),
        ("output_tokens", ""),
        ("requests", "1.5"),
        ("billed_cost", "Infinity"),
    ],
)
def test_invalid_required_values_fail_closed(tmp_path: Path, field: str, value: str):
    header = list(
        __import__(
            "ai_cost_lens.canonical", fromlist=["REQUIRED_COLUMNS"]
        ).REQUIRED_COLUMNS
    )
    row = [
        "u1",
        "2026-07-01",
        "openai",
        "m",
        "USD",
        "1",
        "0",
        "1",
        "0",
        "1",
        "1",
        "1",
        "provider_reported",
        "p",
        "t",
        "dev",
        "task",
    ]
    row[header.index(field)] = value
    path = tmp_path / "bad.csv"
    path.write_text(",".join(header) + "\n" + ",".join(row) + "\n")
    with pytest.raises(CanonicalError):
        load_usage(path)


def test_calculated_unknown_model_fails_instead_of_zero(tmp_path: Path):
    source = (DATA_DIR / "canonical-usage-v2.csv").read_text()
    source = source.replace("illustrative-model-a", "unsupported-model")
    usage = tmp_path / "usage.csv"
    usage.write_text(source)
    price_book = json.loads((DATA_DIR / "illustrative-price-book.json").read_text())
    price_book["mode"] = "real"
    real_price_book = tmp_path / "real-price-book.json"
    real_price_book.write_text(json.dumps(price_book))
    result = CliRunner().invoke(
        cli,
        [
            "ccac",
            "--input",
            str(usage),
            "--price-book",
            str(real_price_book),
        ],
    )
    assert result.exit_code == 1
    assert "no zero-cost fallback" in result.output


def test_usage_before_price_book_effective_date_is_rejected(tmp_path: Path):
    source = (
        (DATA_DIR / "canonical-usage-v2.csv")
        .read_text()
        .replace("2026-07-01", "2026-06-30")
    )
    usage = tmp_path / "usage.csv"
    usage.write_text(source)
    price_book = json.loads((DATA_DIR / "illustrative-price-book.json").read_text())
    price_book["mode"] = "real"
    real_price_book = tmp_path / "real-price-book.json"
    real_price_book.write_text(json.dumps(price_book))
    result = CliRunner().invoke(
        cli,
        [
            "ccac",
            "--input",
            str(usage),
            "--price-book",
            str(real_price_book),
        ],
    )
    assert result.exit_code == 1
    assert "historical rates are required" in result.output
