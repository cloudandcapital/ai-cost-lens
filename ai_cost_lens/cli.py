"""AI Cost Lens CLI — FOCUS-style cost analysis for OpenAI, Anthropic, and AWS Bedrock."""

from __future__ import annotations

import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List

import click

from . import __version__
from .canonical import CanonicalError
from .ccac import build_result as build_ccac_result
from .providers.detector import FocusRecord, load_and_normalize

SCHEMA_VERSION = "1.0"
EXIT_SUCCESS = 0
EXIT_USAGE_ERROR = 2
EXIT_INPUT_FILE_ERROR = 3
EXIT_SCHEMA_DATA_ERROR = 4
EXIT_INTERNAL_ERROR = 5


class InputFileError(Exception):
    pass


class SchemaDataError(Exception):
    pass


@click.group()
@click.version_option(version=__version__, prog_name="ai-cost-lens")
def cli() -> None:
    """AI Cost Lens — FOCUS-style cost analysis for OpenAI, Anthropic, and AWS Bedrock."""


@cli.command("ccac")
@click.option(
    "--input",
    "input_path",
    type=click.Path(path_type=Path, exists=True, dir_okay=False),
    help="Canonical ai-cost-lens/2.0 usage CSV.",
)
@click.option(
    "--price-book",
    type=click.Path(path_type=Path, exists=True, dir_okay=False),
    help="Versioned JSON price book for calculated rows.",
)
@click.option(
    "--demo", is_flag=True, help="Use deterministic illustrative usage and prices."
)
@click.option(
    "--output",
    type=click.Path(path_type=Path, dir_okay=False),
    help="Write CCAC JSON instead of stdout.",
)
@click.option("--run-id")
@click.option("--generated-at")
def ccac_command(
    input_path: Path | None,
    price_book: Path | None,
    demo: bool,
    output: Path | None,
    run_id: str | None,
    generated_at: str | None,
) -> None:
    """Produce strict, reconciled CCAC AI usage output."""
    if demo and input_path is not None or not demo and input_path is None:
        raise click.UsageError("provide either --demo or --input")
    if demo:
        data_dir = Path(__file__).resolve().parent / "data"
        input_path = data_dir / "canonical-usage-v2.csv"
        price_book = data_dir / "illustrative-price-book.json"
        run_id = run_id or "123e4567-e89b-12d3-a456-426614174030"
        generated_at = generated_at or "2026-08-04T12:15:00Z"
    try:
        payload = build_ccac_result(input_path, price_book_path=price_book, mode="illustrative" if demo else "real", run_id=run_id, generated_at=generated_at)  # type: ignore[arg-type]
    except CanonicalError as exc:
        raise click.ClickException(str(exc)) from exc
    rendered = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if output is None:
        click.echo(rendered, nl=False)
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")


# ---------------------------------------------------------------------------
# analyze
# ---------------------------------------------------------------------------


@cli.command("analyze")
@click.option(
    "--input",
    "input_path",
    type=click.Path(path_type=Path, exists=True, dir_okay=False),
    required=True,
    help="Path to AI billing CSV export.",
)
@click.option(
    "--group-by",
    type=click.Choice(["model", "day"], case_sensitive=False),
    default="model",
    show_default=True,
    help="Aggregate by model name or by calendar day.",
)
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["json", "csv", "table"], case_sensitive=False),
    default="table",
    show_default=True,
    help="Output format.",
)
@click.pass_context
def analyze(
    ctx: click.Context, input_path: Path, group_by: str, output_format: str
) -> None:
    """Read an AI billing CSV and produce FOCUS-style cost analysis."""
    try:
        records = _load(input_path)
        rows = _aggregate(records, group_by.lower())
        _emit_analyze(rows, group_by.lower(), output_format.lower(), sys.stdout)
    except InputFileError as exc:
        click.echo(f"Input file error: {exc}", err=True)
        ctx.exit(EXIT_INPUT_FILE_ERROR)
    except SchemaDataError as exc:
        click.echo(f"Schema/data error: {exc}", err=True)
        ctx.exit(EXIT_SCHEMA_DATA_ERROR)
    except Exception as exc:
        click.echo(f"Internal error: {exc}", err=True)
        ctx.exit(EXIT_INTERNAL_ERROR)


# ---------------------------------------------------------------------------
# compare
# ---------------------------------------------------------------------------


@cli.command("compare")
@click.option(
    "--baseline",
    "baseline_path",
    type=click.Path(path_type=Path, exists=True, dir_okay=False),
    required=True,
    help="Path to baseline period billing CSV.",
)
@click.option(
    "--proposed",
    "proposed_path",
    type=click.Path(path_type=Path, exists=True, dir_okay=False),
    required=True,
    help="Path to proposed/comparison period billing CSV.",
)
@click.option(
    "--group-by",
    type=click.Choice(["model", "day"], case_sensitive=False),
    default="model",
    show_default=True,
    help="Aggregate by model name or by calendar day.",
)
@click.pass_context
def compare(
    ctx: click.Context, baseline_path: Path, proposed_path: Path, group_by: str
) -> None:
    """Compare AI spend between two time periods side by side."""
    try:
        baseline_records = _load(baseline_path)
        proposed_records = _load(proposed_path)
        baseline_rows = _aggregate(baseline_records, group_by.lower())
        proposed_rows = _aggregate(proposed_records, group_by.lower())
        _emit_compare(
            baseline_rows,
            proposed_rows,
            group_by.lower(),
            str(baseline_path),
            str(proposed_path),
            sys.stdout,
        )
    except InputFileError as exc:
        click.echo(f"Input file error: {exc}", err=True)
        ctx.exit(EXIT_INPUT_FILE_ERROR)
    except SchemaDataError as exc:
        click.echo(f"Schema/data error: {exc}", err=True)
        ctx.exit(EXIT_SCHEMA_DATA_ERROR)
    except Exception as exc:
        click.echo(f"Internal error: {exc}", err=True)
        ctx.exit(EXIT_INTERNAL_ERROR)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _load(path: Path) -> List[FocusRecord]:
    if not path.exists():
        raise InputFileError(f"File not found: {path}")
    try:
        return load_and_normalize(path)
    except ValueError as exc:
        raise SchemaDataError(str(exc)) from exc
    except PermissionError as exc:
        raise InputFileError(f"File not readable: {path}") from exc


def _aggregate(records: List[FocusRecord], group_by: str) -> List[Dict[str, Any]]:
    """Return sorted list of {key, cost, input_tokens, output_tokens, requests, provider}."""
    totals: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {
            "cost": 0.0,
            "input_tokens": 0,
            "output_tokens": 0,
            "requests": 0,
            "providers": set(),
        }
    )

    for r in records:
        key = r.ServiceName if group_by == "model" else r.ChargePeriodStart
        if not key:
            raise SchemaDataError("model/date grouping value is missing")
        try:
            cost = float(r.BilledCost)
            input_tokens = int(r.input_tokens)
            output_tokens = int(r.output_tokens)
            requests = int(r.requests)
        except (TypeError, ValueError) as exc:
            raise SchemaDataError(
                f"Invalid required numeric value for model {r.ServiceName!r}"
            ) from exc
        if (
            not math.isfinite(cost)
            or cost < 0
            or input_tokens < 0
            or output_tokens < 0
            or requests < 0
        ):
            raise SchemaDataError(
                f"Non-finite or negative numeric value for model {r.ServiceName!r}"
            )
        totals[key]["cost"] += cost
        totals[key]["input_tokens"] += input_tokens
        totals[key]["output_tokens"] += output_tokens
        totals[key]["requests"] += requests
        totals[key]["providers"].add(r.provider)

    rows = []
    for key, data in totals.items():
        rows.append(
            {
                "key": key,
                "cost": round(data["cost"], 4),
                "input_tokens": data["input_tokens"],
                "output_tokens": data["output_tokens"],
                "requests": data["requests"],
                "provider": ",".join(sorted(data["providers"])),
            }
        )

    rows.sort(key=lambda r: r["cost"], reverse=True)
    return rows


def _emit_analyze(rows: List[Dict[str, Any]], group_by: str, fmt: str, out) -> None:
    label = "Model" if group_by == "model" else "Date"
    if fmt == "json":
        payload = {
            "schema_version": SCHEMA_VERSION,
            "group_by": group_by,
            "total_cost": round(sum(r["cost"] for r in rows), 4),
            "rows": rows,
        }
        json.dump(payload, out, indent=2)
        out.write("\n")
    elif fmt == "csv":
        writer = csv.DictWriter(
            out,
            fieldnames=[
                "key",
                "cost",
                "input_tokens",
                "output_tokens",
                "requests",
                "provider",
            ],
            lineterminator="\n",
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    else:
        _print_table(rows, label, out)


def _print_table(rows: List[Dict[str, Any]], label: str, out) -> None:
    if not rows:
        out.write("No data.\n")
        return
    key_w = max(len(label), max(len(str(r["key"])) for r in rows))
    prov_w = max(8, max(len(r["provider"]) for r in rows))
    header = f"  {label:<{key_w}}  {'Cost':>10}  {'Input Tok':>12}  {'Output Tok':>12}  {'Requests':>10}  {'Provider':<{prov_w}}"
    sep = "  " + "-" * (len(header) - 2)
    out.write(f"{sep}\n{header}\n{sep}\n")
    total_cost = 0.0
    for r in rows:
        out.write(
            f"  {str(r['key']):<{key_w}}  ${r['cost']:>9.4f}  {r['input_tokens']:>12,}  "
            f"{r['output_tokens']:>12,}  {r['requests']:>10,}  {r['provider']:<{prov_w}}\n"
        )
        total_cost += r["cost"]
    out.write(f"{sep}\n")
    out.write(f"  {'TOTAL':<{key_w}}  ${total_cost:>9.4f}\n")


def _emit_compare(
    baseline: List[Dict],
    proposed: List[Dict],
    group_by: str,
    baseline_name: str,
    proposed_name: str,
    out,
) -> None:
    b_map = {r["key"]: r["cost"] for r in baseline}
    p_map = {r["key"]: r["cost"] for r in proposed}
    all_keys = sorted(set(b_map) | set(p_map))

    label = "Model" if group_by == "model" else "Date"
    key_w = max(len(label), max((len(k) for k in all_keys), default=8))
    header = f"  {label:<{key_w}}  {'Baseline':>12}  {'Proposed':>12}  {'Delta':>12}"
    sep = "  " + "-" * (len(header) - 2)

    out.write(f"Comparison: {baseline_name}  vs  {proposed_name}\n")
    out.write(f"{sep}\n{header}\n{sep}\n")

    rows = []
    for key in all_keys:
        b = b_map.get(key, 0.0)
        p = p_map.get(key, 0.0)
        rows.append((key, b, p, p - b))
    rows.sort(key=lambda r: abs(r[3]), reverse=True)

    total_b = total_p = 0.0
    for key, b, p, delta in rows:
        sign = "+" if delta >= 0 else ""
        out.write(
            f"  {key:<{key_w}}  ${b:>11.4f}  ${p:>11.4f}  {sign}${delta:>10.4f}\n"
        )
        total_b += b
        total_p += p
    total_d = total_p - total_b
    sign = "+" if total_d >= 0 else ""
    out.write(f"{sep}\n")
    out.write(
        f"  {'TOTAL':<{key_w}}  ${total_b:>11.4f}  ${total_p:>11.4f}  {sign}${total_d:>10.4f}\n"
    )


def main() -> None:
    cli()


if __name__ == "__main__":
    main()
