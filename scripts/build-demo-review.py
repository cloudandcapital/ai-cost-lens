from __future__ import annotations

import json
from pathlib import Path

from ai_cost_lens.review import build_review

ROOT = Path(__file__).parents[1]
SOURCE = ROOT / "ai_cost_lens" / "data" / "illustrative-review-v1.json"
TARGET = ROOT / "web" / "data" / "illustrative-review-result.json"

payload = json.loads(SOURCE.read_text(encoding="utf-8"))
TARGET.write_text(
    json.dumps(build_review(payload), indent=2) + "\n",
    encoding="utf-8",
)
print(f"Built {TARGET.relative_to(ROOT)}")
