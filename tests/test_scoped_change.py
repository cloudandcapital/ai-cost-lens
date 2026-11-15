"""Scoped driver acceptance against the actual browser calculation engine."""

import json
import subprocess
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = Path(__file__).parents[1]


def test_scoped_change_financial_acceptance():
    result = subprocess.run(
        ["node", "scripts/check-scoped-change.mjs"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    assert json.loads(result.stdout)["result"] == "passed"


def test_scoped_change_actual_render_and_selector_handler():
    result = subprocess.run(
        ["node", "scripts/check-scoped-change-ui.mjs"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    assert json.loads(result.stdout)["result"] == "passed"


def test_scoped_change_reviews_validate_against_versioned_contracts():
    result = subprocess.run(
        ["node", "scripts/check-scoped-change.mjs", "--records"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    event = json.loads(
        (ROOT / "schemas/ai-cost-lens-usage-event-1.1.schema.json").read_text()
    )
    review = json.loads(
        (ROOT / "schemas/ai-cost-lens-usage-review-1.2.schema.json").read_text()
    )
    Draft202012Validator.check_schema(event)
    Draft202012Validator.check_schema(review)
    registry = Registry().with_resource(event["$id"], Resource.from_contents(event))
    validator = Draft202012Validator(
        review, registry=registry, format_checker=FormatChecker()
    )
    for record in json.loads(result.stdout).values():
        validator.validate(record)


if __name__ == "__main__":
    test_scoped_change_financial_acceptance()
    test_scoped_change_actual_render_and_selector_handler()
    test_scoped_change_reviews_validate_against_versioned_contracts()
    print("Scoped financial and versioned-contract checks passed")
