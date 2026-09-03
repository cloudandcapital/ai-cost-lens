#!/usr/bin/env python3
"""Run one locked route in an AI Cost Lens OpenAI model-route pilot."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ai_cost_lens.model_route_pilot import (
    DEFAULT_EXPERIMENT_ID,
    ROUTES,
    ModelRoutePilotError,
    run_route,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("route", choices=sorted(ROUTES))
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--experiment", default=DEFAULT_EXPERIMENT_ID)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    try:
        result = run_route(
            root,
            args.route,
            args.output_dir,
            experiment_id=args.experiment,
        )
    except ModelRoutePilotError as exc:
        parser.error(str(exc))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
