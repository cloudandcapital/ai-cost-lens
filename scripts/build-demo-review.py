from __future__ import annotations

import json
from pathlib import Path

from ai_cost_lens.review import build_review

ROOT = Path(__file__).parents[1]
for source_name, target_name in (
    ("illustrative-review-v1.json", "illustrative-review-result.json"),
    ("startup-growth-review-v1.json", "startup-growth-review-result.json"),
):
    source = ROOT / "ai_cost_lens" / "data" / source_name
    target = ROOT / "web" / "data" / target_name
    payload = json.loads(source.read_text(encoding="utf-8"))
    target.write_text(
        json.dumps(build_review(payload), indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Built {target.relative_to(ROOT)}")
