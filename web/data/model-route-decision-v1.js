window.AI_COST_LENS_MODEL_ROUTE_DECISION = {
  "schema_version": "ai-cost-lens-decision-record/0.1",
  "record_profile": "model_route/0.1",
  "decision_id": "openai-model-route-002-decision-v1",
  "recorded_at": "2026-09-01T00:00:00Z",
  "mode": "controlled_synthetic_pilot",
  "question": "Should Luna replace Sol as the default route for finance-facing decisions?",
  "title": "Luna cost 94% less. It still did not earn the finance default.",
  "workload": {
    "name": "Finance decision review",
    "description": "Ten bounded AI finance cases covering pricing, caching, commitments, policy, retries, benchmarks, human review, and currency boundaries.",
    "case_count": 10,
    "evidence_label": "CONTROLLED SYNTHETIC PILOT",
    "conditions": [
      "Identical cases and input tokens",
      "Strict structured output",
      "No tools or automatic retries",
      "Provider charges reconciled to the OpenAI cost export"
    ]
  },
  "decision": {
    "code": "KEEP_BASELINE",
    "label": "KEEP SOL AS THE DEFAULT",
    "recommendation": "Keep Sol on finance-facing decisions. Test Luna later only for low-materiality work behind arithmetic checks and explicit escalation.",
    "reason": "Luna cut the provider bill by 94.25%, but exact responses fell from nine to five and its accepted set included internally conflicting financial numbers."
  },
  "routes": {
    "baseline": {
      "role": "CURRENT DEFAULT",
      "label": "Sol",
      "model": "gpt-5.6-sol",
      "requests": 10,
      "input_tokens": 6852,
      "output_tokens": 1880,
      "cached_input_tokens": 0,
      "provider_cost_usd": 0.065008,
      "exact_responses": 9,
      "rapid_trust_acceptance": 7,
      "accepted_and_exact": 6,
      "accepted_with_material_error": 1,
      "cost_per_exact_response_usd": 0.007223111111111111
    },
    "proposed": {
      "role": "LOWER-COST ROUTE",
      "label": "Luna",
      "model": "gpt-5.6-luna",
      "requests": 10,
      "input_tokens": 6852,
      "output_tokens": 1974,
      "cached_input_tokens": 0,
      "provider_cost_usd": 0.0037392,
      "exact_responses": 5,
      "rapid_trust_acceptance": 4,
      "accepted_and_exact": 1,
      "accepted_with_material_error": 3,
      "cost_per_exact_response_usd": 0.00074784
    }
  },
  "comparison": {
    "provider_cost_difference_usd": 0.0612688,
    "provider_cost_reduction_pct": 94.2480925442238,
    "exact_response_change_points": -40,
    "all_in_cost_difference_usd": null,
    "human_review_cost_usd": null,
    "headline_metric": "94.25% lower provider bill",
    "quality_metric": "9/10 vs 5/10 exact",
    "limitation": "Human correction time was not measured in a valid controlled review, so the total cost of a usable finance decision remains unknown.",
    "gates": {
      "equivalent_work": true,
      "compatible_cost_basis": true,
      "accepted_outcome_definition": true,
      "valid_human_review_cost": false
    }
  },
  "claims": [
    {
      "claim_id": "provider_cost_savings",
      "statement": "Luna reduced the provider charge by 94.25% for the same ten-case input workload.",
      "state": "VERIFIED_FACT",
      "source_ids": [
        "provider_bill"
      ],
      "blocked_by": []
    },
    {
      "claim_id": "all_in_savings",
      "statement": "Luna reduced the all-in cost of a usable finance decision.",
      "state": "UNKNOWN",
      "source_ids": [
        "provider_bill",
        "human_review"
      ],
      "blocked_by": [
        "invalid_human_review_timing"
      ]
    },
    {
      "claim_id": "drop_in_replacement",
      "statement": "Luna is a safe unguarded replacement for Sol on finance-facing decisions.",
      "state": "CONTRADICTED",
      "source_ids": [
        "locked_correctness",
        "human_review"
      ],
      "blocked_by": []
    }
  ],
  "evidence": [
    {
      "evidence_id": "provider_bill",
      "topic": "Provider bill",
      "state": "VERIFIED_FACT",
      "value": "$0.0650080 vs $0.0037392",
      "detail": "Usage totals matched the preserved API evidence and the three September 1 runs reconciled exactly to the $0.1287832 OpenAI organization cost export.",
      "source": "OpenAI organization usage and cost exports"
    },
    {
      "evidence_id": "locked_correctness",
      "topic": "Objective correctness",
      "state": "VERIFIED_FACT",
      "value": "Sol 9/10 · Luna 5/10",
      "detail": "Each response was scored against the locked answer key created before either route was run.",
      "source": "Pilot 002 locked cases and answer key"
    },
    {
      "evidence_id": "human_review",
      "topic": "Reviewer trust",
      "state": "LIMITED_EVIDENCE",
      "value": "Sol 7/10 · Luna 4/10",
      "detail": "The blinded choices reveal false-confidence risk, but prior exposure, restarts, and implausibly short review times prevent a controlled human-cost claim.",
      "source": "Blinded rapid-trust review"
    },
    {
      "evidence_id": "all_in_economics",
      "topic": "All-in economics",
      "state": "UNKNOWN",
      "value": "Not available",
      "detail": "A stable fresh review must measure checking and correction time before model cost and human cost can share one boundary.",
      "source": "Not yet measured"
    }
  ],
  "limitations": [
    {
      "limitation_id": "invalid_human_review_timing",
      "effect": "The recorded review times are too short and too contaminated by prior exposure to value human labor or calculate all-in savings.",
      "blocks": [
        "all_in_savings"
      ]
    }
  ],
  "consistency_checks": [
    {
      "check_id": "cap-vs-value.total-to-unit-reconciliation",
      "status": "FAIL",
      "material": true,
      "left": {
        "label": "Narrative total cost",
        "value": 1400,
        "unit": "USD"
      },
      "right": {
        "label": "Structured unit cost multiplied by 30 accepted results",
        "value": 8600.1,
        "unit": "USD"
      },
      "source_ids": [
        "locked_correctness"
      ]
    },
    {
      "check_id": "human-cost-reversal.memo-to-structured-metric",
      "status": "FAIL",
      "material": true,
      "left": {
        "label": "Premium calculated in the memo",
        "value": 1200,
        "unit": "USD"
      },
      "right": {
        "label": "Premium returned in the structured metric",
        "value": 1500,
        "unit": "USD"
      },
      "source_ids": [
        "locked_correctness"
      ]
    }
  ],
  "risk_cases": [
    {
      "case_id": "cap-vs-value",
      "route": "Luna",
      "headline": "The memo and metric disagreed.",
      "detail": "The narrative named $1,400 of total cost while the structured field reported $286.67 per accepted result. The locked answer was $46.67."
    },
    {
      "case_id": "human-cost-reversal",
      "route": "Luna",
      "headline": "A correct calculation sat beside the wrong result.",
      "detail": "The memo calculated a $1,200 premium while the structured metric returned $1,500. The response still looked review-ready."
    },
    {
      "case_id": "cache-reuse",
      "route": "Both routes",
      "headline": "The decision became too certain.",
      "detail": "Both routes selected REJECT where missing all-in evidence required INVESTIGATE."
    }
  ],
  "controls": [
    "Recompute deterministic arithmetic outside the model",
    "Compare narrative calculations with structured fields",
    "Block approvals when values, units, or decisions conflict",
    "Send unresolved or material cases to expert review"
  ],
  "next_test": {
    "question": "How much human review and correction time does each route require when the reviewer is fresh and the interface does not force a judgment?",
    "smallest_test": "Run one fresh blinded review with an expert reviewer, allow unsure as a complete answer, and time review and correction separately.",
    "inputs": [
      "The same twenty preserved responses",
      "The locked answer key kept hidden until review is complete",
      "A declared $60 per hour labor rate"
    ],
    "metrics": [
      "Review minutes",
      "Correction minutes",
      "Accepted and exact responses",
      "Accepted material errors",
      "All-in cost per usable finance decision"
    ],
    "cash_cost_ceiling_usd": 1
  },
  "story": {
    "eyebrow": "MODEL ROUTE DECISION",
    "title": "Luna cost 94% less. It still did not earn the finance default.",
    "finding": "The lower model bill survived reconciliation. The all-in savings claim did not.",
    "limitation": "Human correction time remains unmeasured.",
    "source_line": "Controlled synthetic pilot · OpenAI API evidence · Not customer data"
  },
  "sources": [
    "OpenAI Responses API evidence archives",
    "OpenAI completion usage export",
    "OpenAI organization cost export",
    "Locked Pilot 002 cases and answer key",
    "Blinded rapid-trust review"
  ]
};
