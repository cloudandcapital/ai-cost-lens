from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
WEB = ROOT / "web"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_versioned_catalog_and_deterministic_prompt_pricing():
    script = r"""
const catalog = require(process.argv[1]);
const engine = require(process.argv[2]);
engine.validateCatalog(catalog);
const scenario = {
  input_tokens: 1000,
  output_tokens: 500,
  calls_per_month: 1000,
  retry_rate: 0.10,
  cached_input_share: 0.25,
  usable_rate: 0.80,
  batch: false,
};
const comparison = engine.compareModels(
  catalog,
  ["openai/gpt-5.6-sol", "anthropic/claude-sonnet-5"],
  scenario,
);
const record = engine.buildEstimateRecord(
  catalog,
  comparison,
  scenario,
  {tokens: 1000, method: "manual"},
  "2026-09-20T12:00:00.000Z",
);
console.log(JSON.stringify({catalog, comparison, record}));
"""
    result = subprocess.run(
        [
            "node",
            "-e",
            script,
            str(WEB / "data" / "pricing-catalog-v0.5.js"),
            str(WEB / "pricing-engine.js"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    catalog = payload["catalog"]
    assert catalog["schema_version"] == "ai-cost-lens-pricing-catalog/0.5"
    assert catalog["catalog_version"] == "2026-09-22"
    assert {model["provider"] for model in catalog["models"]} == {
        "OpenAI",
        "Anthropic",
        "Google",
    }
    assert all(source["url"].startswith("https://") for source in catalog["sources"])
    assert all(
        model["source_url"].startswith("https://") for model in catalog["models"]
    )
    assert all(model["verified_at"] == "2026-09-22" for model in catalog["models"])
    assert all(
        model["capability_source_url"].startswith("https://")
        for model in catalog["models"]
    )
    assert all(model["workload_tags"] for model in catalog["models"])
    assert {tag for model in catalog["models"] for tag in model["workload_tags"]} == {
        "general",
        "reasoning",
        "coding",
        "high_volume",
        "long_context",
        "multimodal",
    }
    assert any(model["id"] == "google/gemini-3.8-flash" for model in catalog["models"])

    current, alternative = payload["comparison"]
    # ((750 * 4) + (250 * .4) + (500 * 20)) / 1M * 1,100 calls
    assert current["estimated_monthly_cost_usd"] == 14.41
    assert current["estimated_cost_per_usable_result_usd"] == 0.0180125
    assert alternative["estimated_monthly_cost_usd"] == 7.205
    assert alternative["monthly_difference_from_current_usd"] == -7.205

    record = payload["record"]
    assert record["application_version"] == "0.5.0"
    assert record["evidence_gate"]["decision"] == "TEST_FIRST"
    assert record["evidence_gate"]["savings_claim_allowed"] is False
    assert record["estimate_basis"]["prompt_text_stored"] is False
    assert "prompt" not in record["estimate_basis"]
    schema = json.loads(
        (
            ROOT / "schemas" / "ai-cost-lens-prompt-price-estimate-0.6.schema.json"
        ).read_text()
    )
    assert set(record) == set(schema["required"])
    assert set(record["catalog"]) == set(schema["properties"]["catalog"]["required"])
    assert set(record["estimate_basis"]) == set(
        schema["properties"]["estimate_basis"]["required"]
    )
    model_fields = set(schema["$defs"]["modelEstimate"]["required"])
    assert all(set(item) == model_fields for item in record["comparison"])


def test_prompt_price_estimate_schema_is_versioned_private_and_fail_closed():
    schema = json.loads(
        (
            ROOT / "schemas" / "ai-cost-lens-prompt-price-estimate-0.6.schema.json"
        ).read_text()
    )
    assert schema["additionalProperties"] is False
    assert (
        schema["properties"]["schema_version"]["const"]
        == "ai-cost-lens-prompt-price-estimate/0.6"
    )
    assert (
        schema["properties"]["estimate_basis"]["properties"]["prompt_text_stored"][
            "const"
        ]
        is False
    )
    assert (
        schema["properties"]["evidence_gate"]["properties"]["savings_claim_allowed"][
            "const"
        ]
        is False
    )
    assert '"prompt_text"' not in json.dumps(schema)


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_catalog_rates_match_the_verified_official_snapshot():
    script = r"""
const catalog = require(process.argv[1]);
console.log(JSON.stringify(Object.fromEntries(catalog.models.map((model) => [model.id, {standard: model.standard, batch: model.batch}]))));
"""
    result = subprocess.run(
        ["node", "-e", script, str(WEB / "data" / "pricing-catalog-v0.5.js")],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    actual = json.loads(result.stdout)
    expected = {
        "openai/gpt-6-astra": ((10, 1, 50), (5, 0.5, 25)),
        "openai/gpt-5.6-sol": ((4, 0.4, 20), (2, 0.2, 10)),
        "openai/gpt-5.6-terra": ((2, 0.2, 12), (1, 0.1, 6)),
        "openai/gpt-5.6-luna": ((0.2, 0.02, 1.2), (0.1, 0.01, 0.6)),
        "anthropic/claude-fable-5.1": ((10, 0.25, 50), (5, 0.125, 25)),
        "anthropic/claude-opus-5": ((5, 0.5, 25), (2.5, 0.25, 12.5)),
        "anthropic/claude-sonnet-5": ((2, 0.2, 10), (1, 0.1, 5)),
        "anthropic/claude-sonnet-4.6": ((3, 0.3, 15), (1.5, 0.15, 7.5)),
        "anthropic/claude-haiku-4.5": ((1, 0.1, 5), (0.5, 0.05, 2.5)),
        "google/gemini-3.8-flash": ((0.75, 0.075, 3.75), (0.375, 0.0375, 1.875)),
        "google/gemini-3.7-flash": ((0.75, 0.075, 3.75), (0.375, 0.0375, 1.875)),
        "google/gemini-3.5-flash": ((1.5, 0.15, 9), (0.75, 0.075, 4.5)),
        "google/gemini-3.5-flash-lite": ((0.3, 0.03, 2.5), (0.15, 0.02, 1.25)),
        "google/gemini-3.1-flash-lite": ((0.25, 0.025, 1.5), (0.125, 0.0125, 0.75)),
    }
    assert set(actual) == set(expected)
    for model_id, (standard, batch) in expected.items():
        for field, value in zip(
            ("input", "cached_input", "output"), standard, strict=True
        ):
            assert actual[model_id]["standard"][field] == value
        for field, value in zip(
            ("input", "cached_input", "output"), batch, strict=True
        ):
            assert actual[model_id]["batch"][field] == value


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_provider_specific_modes_cache_writes_geography_and_storage_are_explicit():
    script = r"""
const catalog = require(process.argv[1]);
const engine = require(process.argv[2]);
const byId = Object.fromEntries(catalog.models.map((model) => [model.id, model]));
const base = {input_tokens: 1000, output_tokens: 0, calls_per_month: 100, retry_rate: 0,
  cached_input_share: .5, usable_rate: null, pricing_date: "2026-09-22"};
const claude = engine.priceModel(byId["anthropic/claude-sonnet-5"], {
  ...base, cache_refreshes_per_month: 10, cache_write_duration: "1h",
}, {processing_mode: "standard", geography: "us"});
const gemini = engine.priceModel(byId["google/gemini-3.8-flash"], {
  ...base, cached_input_share: 0, cache_storage_token_hours_per_month: 2_000_000,
}, {processing_mode: "priority", geography: "global"});
const openai = engine.priceModel(byId["openai/gpt-5.6-sol"], {
  ...base, input_tokens: 300000, output_tokens: 1000,
}, {processing_mode: "flex", geography: "regional"});
let unsupported = false;
try { engine.priceModel(byId["anthropic/claude-sonnet-5"], base, {processing_mode: "flex"}); }
catch (_error) { unsupported = true; }
console.log(JSON.stringify({claude, gemini, openai, unsupported}));
"""
    result = subprocess.run(
        [
            "node",
            "-e",
            script,
            str(WEB / "data" / "pricing-catalog-v0.5.js"),
            str(WEB / "pricing-engine.js"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    claude = payload["claude"]
    assert claude["processing_mode"] == "standard"
    assert claude["geography"] == "us"
    assert claude["geography_multiplier"] == 1.1
    assert claude["cache_write_rate_field"] == "cache_write_1h"
    assert claude["rates_per_1m_tokens"]["cache_write_1h"] == 4.4
    assert claude["estimated_monthly_cost_usd"] == 0.1419
    gemini = payload["gemini"]
    assert gemini["processing_mode"] == "priority"
    assert gemini["estimated_monthly_cost_breakdown_usd"]["cache_storage"] == 1
    openai = payload["openai"]
    assert openai["processing_mode"] == "flex"
    assert openai["pricing_adjustment"] == "long_context"
    assert openai["geography_multiplier"] == 1.1
    assert openai["rates_per_1m_tokens"] == {
        "input": 4.4,
        "cached_input": 0.44,
        "cache_write": 5.5,
        "output": 16.5,
    }
    assert payload["unsupported"] is True


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_token_estimate_batch_price_and_validation_fail_closed():
    script = r"""
const catalog = require(process.argv[1]);
const engine = require(process.argv[2]);
const model = catalog.models.find((item) => item.id === "google/gemini-3.7-flash");
const estimated = engine.estimateInputTokens("123456789", "");
const manual = engine.estimateInputTokens("ignored", "42");
const exact = engine.estimateInputTokens("private prompt", "", "OpenAI", (text) => text === "private prompt" ? 7 : 0);
const otherProvider = engine.estimateInputTokens("123456789", "", "Anthropic", () => 999);
const priced = engine.priceModel(model, {
  input_tokens: 1000, output_tokens: 500, calls_per_month: 1000,
  retry_rate: 0, cached_input_share: 0, usable_rate: null, batch: true,
});
let rejected = false;
try {
  engine.priceModel(model, {
    input_tokens: 1, output_tokens: 1, calls_per_month: 1,
    retry_rate: 0, cached_input_share: 1.01, usable_rate: null, batch: false,
  });
} catch (_error) { rejected = true; }
console.log(JSON.stringify({estimated, manual, exact, otherProvider, priced, rejected}));
"""
    result = subprocess.run(
        [
            "node",
            "-e",
            script,
            str(WEB / "data" / "pricing-catalog-v0.5.js"),
            str(WEB / "pricing-engine.js"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["estimated"] == {
        "tokens": 3,
        "method": "character_estimate_4_to_1",
    }
    assert payload["manual"] == {"tokens": 42, "method": "manual"}
    assert payload["exact"] == {
        "tokens": 7,
        "method": "openai_o200k_base_exact_raw_text",
    }
    assert payload["otherProvider"] == {
        "tokens": 3,
        "method": "character_estimate_4_to_1",
    }
    assert payload["priced"]["rate_tier"] == "batch"
    assert payload["priced"]["estimated_monthly_cost_usd"] == 1.3125
    assert payload["priced"]["estimated_cost_per_usable_result_usd"] is None
    assert payload["rejected"] is True


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_user_supplied_contract_rate_is_local_versioned_and_still_test_first():
    script = r"""
const catalog = require(process.argv[1]);
const engine = require(process.argv[2]);
const custom = engine.normalizeCustomModel({
  id: "custom/user-supplied-rate",
  provider: "Private gateway",
  label: "Contract route",
  effective_at: "2026-09-01",
  pricing_source_note: "2026 contract rate card",
  standard: {input: 1, cached_input: .25, output: 5},
  batch: {input: "", cached_input: "", output: ""},
  context_window_tokens: 100000,
  max_output_tokens: 10000,
});
const scenario = {
  input_tokens: 1000, output_tokens: 500, calls_per_month: 1000,
  retry_rate: 0, cached_input_share: .25, usable_rate: null, batch: false,
};
const ids = ["openai/gpt-5.6-sol", custom.id];
const estimates = Object.fromEntries(ids.map((id) => [id, {tokens: 1000, method: "manual"}]));
const comparison = engine.compareModels(catalog, ids, scenario, estimates, [custom]);
const record = engine.buildEstimateRecord(catalog, comparison, scenario, estimates[ids[0]], "2026-09-21T00:00:00Z");
let partialBatchRejected = false;
let missingBatchRejected = false;
let duplicateRejected = false;
try { engine.normalizeCustomModel({...custom, batch: {input: 1, cached_input: "", output: 2}}); } catch (_error) { partialBatchRejected = true; }
try { engine.priceModel(custom, {...scenario, batch: true}); } catch (_error) { missingBatchRejected = true; }
try { engine.compareModels(catalog, [custom.id, custom.id], scenario, estimates, [custom]); } catch (_error) { duplicateRejected = true; }
console.log(JSON.stringify({custom, comparison, record, partialBatchRejected, missingBatchRejected, duplicateRejected}));
"""
    result = subprocess.run(
        [
            "node",
            "-e",
            script,
            str(WEB / "data" / "pricing-catalog-v0.5.js"),
            str(WEB / "pricing-engine.js"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    custom = payload["comparison"][1]
    assert custom["pricing_basis"] == "user_supplied"
    assert custom["pricing_source_url"] is None
    assert custom["pricing_source_note"] == "2026 contract rate card"
    assert custom["pricing_verified_at"] is None
    assert custom["pricing_effective_at"] == "2026-09-01"
    assert custom["estimated_monthly_cost_usd"] == 3.3125
    record = payload["record"]
    assert record["schema_version"] == "ai-cost-lens-prompt-price-estimate/0.6"
    assert record["estimate_basis"]["rate_source_scope"] == "mixed"
    assert record["estimate_basis"]["user_supplied_rate_count"] == 1
    assert any(
        "user-supplied rate" in item for item in record["evidence_gate"]["missing"]
    )
    assert record["evidence_gate"]["savings_claim_allowed"] is False
    assert payload["partialBatchRejected"] is True
    assert payload["missingBatchRejected"] is True
    assert payload["duplicateRejected"] is True


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_catalog_rejects_a_price_source_registered_to_another_provider():
    script = r"""
const catalog = require(process.argv[1]);
const engine = require(process.argv[2]);
const changed = JSON.parse(JSON.stringify(catalog));
changed.models[0].source_url = changed.sources.find((source) => source.provider === "Anthropic").url;
try {
  engine.validateCatalog(changed);
  console.log("accepted");
} catch (error) {
  console.log(error.message);
}
"""
    result = subprocess.run(
        [
            "node",
            "-e",
            script,
            str(WEB / "data" / "pricing-catalog-v0.5.js"),
            str(WEB / "pricing-engine.js"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "must reference a pricing source registered for OpenAI" in result.stdout


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_model_specific_token_counts_change_route_prices_without_storing_prompt():
    script = r"""
const catalog = require(process.argv[1]);
const engine = require(process.argv[2]);
const scenario = {
  input_tokens: 1000, output_tokens: 500, calls_per_month: 1000,
  retry_rate: .1, cached_input_share: .25, usable_rate: .8, batch: false,
};
const estimates = {
  "openai/gpt-5.6-sol": {tokens: 1000, method: "openai_o200k_base_exact_raw_text"},
  "anthropic/claude-sonnet-5": {tokens: 2000, method: "character_estimate_4_to_1"},
};
const comparison = engine.compareModels(catalog, Object.keys(estimates), scenario, estimates);
const record = engine.buildEstimateRecord(catalog, comparison, scenario, estimates["openai/gpt-5.6-sol"], "2026-09-21T00:00:00Z");
console.log(JSON.stringify(record));
"""
    result = subprocess.run(
        [
            "node",
            "-e",
            script,
            str(WEB / "data" / "pricing-catalog-v0.5.js"),
            str(WEB / "pricing-engine.js"),
        ],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    record = json.loads(result.stdout)
    current, alternative = record["comparison"]
    assert current["input_tokens"] == 1000
    assert alternative["input_tokens"] == 2000
    assert current["estimated_monthly_cost_usd"] == 14.41
    assert alternative["estimated_monthly_cost_usd"] == 8.91
    assert record["estimate_basis"]["input_token_scope"] == "model_specific"
    assert record["estimate_basis"]["model_token_estimates"] == [
        {
            "model_id": "openai/gpt-5.6-sol",
            "provider": "OpenAI",
            "input_tokens": 1000,
            "input_token_method": "openai_o200k_base_exact_raw_text",
        },
        {
            "model_id": "anthropic/claude-sonnet-5",
            "provider": "Anthropic",
            "input_tokens": 2000,
            "input_token_method": "character_estimate_4_to_1",
        },
    ]
    assert "private prompt" not in json.dumps(record)
    assert record["evidence_gate"]["savings_claim_allowed"] is False


@pytest.mark.skipif(
    shutil.which("node") is None or shutil.which("npm") is None,
    reason="node and npm are required",
)
def test_openai_tokenizer_is_bundled_locally_and_matches_the_package():
    build = subprocess.run(
        ["node", "scripts/build-openai-tokenizer.mjs"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert build.returncode == 0, build.stderr
    script = r"""
const direct = require("gpt-tokenizer/encoding/o200k_base");
require(process.argv[1]);
const local = globalThis.AICostLensOpenAITokenizer;
const text = "Exact local token counting: 你好, κόσμε.";
console.log(JSON.stringify({
  bundled: local.countTokens(text), direct: direct.countTokens(text),
  encoding: local.encoding, version: local.package_version,
}));
"""
    result = subprocess.run(
        ["node", "-e", script, str(WEB / "vendor" / "openai-tokenizer.js")],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["bundled"] == payload["direct"]
    assert payload["encoding"] == "o200k_base"
    assert payload["version"] == "4.0.0"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_catalog_date_selection_long_context_rates_and_token_limits_fail_closed():
    script = r"""
const catalog = require(process.argv[1]);
const engine = require(process.argv[2]);
const older = {...catalog, catalog_version: "2026-08-01", effective_at: "2026-08-01"};
const selected = engine.selectCatalog([catalog, older], "2026-09-01");
const model = catalog.models.find((item) => item.id === "openai/gpt-5.6-sol");
const longContext = engine.priceModel(model, {
  input_tokens: 300000, output_tokens: 10000, calls_per_month: 1,
  retry_rate: 0, cached_input_share: 0, usable_rate: null, batch: false,
});
let contextRejected = false;
let outputRejected = false;
let missingRejected = false;
let invalidDateRejected = false;
let expiredCatalogRejected = false;
try {
  engine.priceModel(model, {
    input_tokens: 1000000, output_tokens: 60000, calls_per_month: 1,
    retry_rate: 0, cached_input_share: 0, usable_rate: null, batch: false,
  });
} catch (_error) { contextRejected = true; }
try {
  engine.priceModel(model, {
    input_tokens: 1, output_tokens: 128001, calls_per_month: 1,
    retry_rate: 0, cached_input_share: 0, usable_rate: null, batch: false,
  });
} catch (_error) { outputRejected = true; }
try {
  engine.priceModel(model, {
    input_tokens: null, output_tokens: 1, calls_per_month: 1,
    retry_rate: 0, cached_input_share: 0, usable_rate: null, batch: false,
  });
} catch (_error) { missingRejected = true; }
try { engine.selectCatalog([catalog], "2026-02-31"); } catch (_error) { invalidDateRejected = true; }
try { engine.requireCatalogDateCoverage(catalog, "2026-11-22"); } catch (_error) { expiredCatalogRejected = true; }
console.log(JSON.stringify({selected: selected.catalog_version, longContext, contextRejected, outputRejected, missingRejected, invalidDateRejected, expiredCatalogRejected}));
"""
    result = subprocess.run(
        [
            "node",
            "-e",
            script,
            str(WEB / "data" / "pricing-catalog-v0.5.js"),
            str(WEB / "pricing-engine.js"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["selected"] == "2026-08-01"
    assert payload["longContext"]["pricing_adjustment"] == "long_context"
    assert payload["longContext"]["rates_per_1m_tokens"] == {
        "input": 8,
        "cached_input": 0.8,
        "cache_write": 10,
        "output": 30,
    }
    assert payload["longContext"]["estimated_monthly_cost_usd"] == 2.7
    assert payload["contextRejected"] is True
    assert payload["outputRejected"] is True
    assert payload["missingRejected"] is True
    assert payload["invalidDateRejected"] is True
    assert payload["expiredCatalogRejected"] is True


def test_price_a_prompt_ui_and_review_handoff_keep_the_evidence_gate():
    html = (WEB / "index.html").read_text()
    app = (WEB / "app.js").read_text()
    engine = (WEB / "pricing-engine.js").read_text()
    assert 'id="price-prompt"' in html
    assert 'id="price-prompt-dialog"' in html
    assert 'id="prompt-current-model"' in html
    assert 'id="send-price-to-review"' in html
    assert "Your prompt stays in this browser" in html
    assert "ESTIMATED · NOT A SAVINGS CLAIM" in html
    assert "state.priceEstimate = cloneData(pendingPriceRecord)" in app
    assert "state.data.pricing_estimate = cloneData(state.priceEstimate)" in app
    assert 'id="download-price-estimate"' in html
    assert "ai-cost-lens-prompt-price-estimate.json" in app
    assert 'id="prompt-custom-rate"' in html
    assert 'id="prompt-custom-source"' in html
    assert "custom/user-supplied-rate" in app
    assert "normalizeCustomModel" in engine
    assert "AI Cost Lens did not verify it" in app
    assert "state.data.comparison.savings_claim_allowed = false" in app
    assert 'decision: "TEST_FIRST"' in engine
    assert "prompt_text_stored: false" in engine
    assert 'id="model-catalog-search"' in html
    assert 'id="model-catalog-provider"' in html
    assert 'id="model-catalog-task"' in html
    assert 'id="model-catalog-rows"' in html
    assert 'class="model-catalog-list"' in html
    assert 'class="model-catalog-card"' in app
    assert 'class="model-catalog-rate"' in app
    assert "Token rates are per 1 million tokens" in app
    assert 'id="add-custom-prompt-rate"' in html
    assert "All four comparison routes are in use" in app
    assert "Price is not a capability or quality score" in html
    assert "renderModelCatalog" in app
    assert "provider-described workload signals are reference only" in app
    assert "provider tokenizers can differ" in app
    assert "openai_o200k_base_exact_raw_text" in app
    assert "requireCatalogDateCoverage" in app
    assert 'src="vendor/openai-tokenizer.js"' not in html
    assert "function ensureOpenAITokenizer()" in app
    assert 'new URL("vendor/openai-tokenizer.js", document.baseURI)' in app
    assert "await ensureOpenAITokenizer()" in app


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
@pytest.mark.parametrize(
    "asset",
    [
        WEB / "pricing-engine.js",
        WEB / "data" / "pricing-catalog-v0.5.js",
    ],
)
def test_prompt_pricing_javascript_has_valid_syntax(asset: Path):
    result = subprocess.run(
        ["node", "--check", str(asset)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
