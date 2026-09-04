window.AI_COST_LENS_REVIEW_PACKET = {
  "schema_version": "ai-cost-lens-human-review-packet/1.0",
  "packet_id": "openai-model-route-002-human-review-v2",
  "experiment_id": "openai-model-route-002",
  "source_hashes": {
    "answer_key_sha256": "4db2cb65b2aa64932d5960174e8ef297915875db68d256e2d3197bba18cf59fe",
    "cases_sha256": "a246a1dedd201b57a911bf4468224c9daf469a8670491c49375869fc866accc5",
    "system_prompt_sha256": "e50f11103f0f90ba4b3e6ca9e361ac59ad9022c1b927781900631e3f68ded0f3"
  },
  "route_names_hidden_until_complete": true,
  "routes": {
    "baseline": {
      "role": "Baseline route",
      "model": "gpt-5.6-sol",
      "input_tokens": 6852,
      "output_tokens": 1880,
      "estimated_token_charge": 0.065008
    },
    "proposed": {
      "role": "Proposed lower-priced route",
      "model": "gpt-5.6-luna",
      "input_tokens": 6852,
      "output_tokens": 1974,
      "estimated_token_charge": 0.0037392
    }
  },
  "items": [
    {
      "item_id": "review-01",
      "response_label": "RESPONSE 01",
      "case_id": "currency-boundary",
      "route_key": "baseline",
      "decision_question": "Can finance approve Route B as cheaper than Route A from the supplied evidence?",
      "situation": "Route A cost $900 USD. Route B cost EUR 800. No exchange-rate source, rate, or effective date was recorded. Work volume and accepted-result counts were equal.",
      "claims": [
        {
          "claim_id": "two_observed_costs",
          "text": "The two observed provider amounts are 900 USD and 800 EUR."
        },
        {
          "claim_id": "b_cheaper",
          "text": "Route B is cheaper after converting both observed costs to one currency."
        }
      ],
      "claim_labels": {
        "two_observed_costs": "The two observed provider amounts are 900 USD and 800 EUR.",
        "b_cheaper": "Route B is cheaper after converting both observed costs to one currency."
      },
      "response": {
        "case_id": "currency-boundary",
        "claim_assessments": [
          {
            "claim_id": "two_observed_costs",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "b_cheaper",
            "state": "UNKNOWN"
          }
        ],
        "decision": "INVESTIGATE",
        "memo": "Finance cannot approve Route B as cheaper yet. The observed amounts are 900 USD for Route A and 800 EUR for Route B, with equal work volume and accepted-result counts. Because the costs are in different currencies and no exchange rate, source, or effective date is supplied, a valid normalized cost difference cannot be calculated.",
        "next_question": "What approved EUR-to-USD exchange-rate source, rate, and effective date should finance use to normalize the two observed costs?",
        "primary_metric": {
          "label": "normalized provider cost difference",
          "unit": "UNAVAILABLE",
          "value": null
        }
      }
    },
    {
      "item_id": "review-02",
      "response_label": "RESPONSE 02",
      "case_id": "retention-gate",
      "route_key": "proposed",
      "decision_question": "Should the candidate model be approved for this workload under the current policy?",
      "situation": "The workload policy permits zero-day provider retention. A candidate model has a mandatory 30-day retention period and a model rate 40% below the approved route. No policy exception has been granted.",
      "claims": [
        {
          "claim_id": "rate_lower",
          "text": "The candidate model rate is 40% lower."
        },
        {
          "claim_id": "policy_eligible",
          "text": "The candidate is eligible for this workload under the stated policy."
        }
      ],
      "claim_labels": {
        "rate_lower": "The candidate model rate is 40% lower.",
        "policy_eligible": "The candidate is eligible for this workload under the stated policy."
      },
      "response": {
        "case_id": "retention-gate",
        "claim_assessments": [
          {
            "claim_id": "rate_lower",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "policy_eligible",
            "state": "CONTRADICTED"
          }
        ],
        "decision": "REJECT",
        "memo": "The candidate cannot be approved under the current policy. The workload allows zero-day provider retention, while the candidate requires 30 days, putting it 30 days above the allowance. No exception has been granted. Although the candidate rate is 40% lower, that economic benefit does not override the policy conflict.",
        "next_question": "NONE - evidence sufficient",
        "primary_metric": {
          "label": "retention period above the policy allowance",
          "unit": "DAYS",
          "value": 30
        }
      }
    },
    {
      "item_id": "review-03",
      "response_label": "RESPONSE 03",
      "case_id": "action-vs-outcome",
      "route_key": "baseline",
      "decision_question": "Should procurement treat each billed standard action as a verified customer resolution when comparing costs?",
      "situation": "A vendor sells 100,000 flex credits for $500 and describes the plan as outcome pricing. One standard agent action consumes 20 credits. Historical cases use three actions before resolution on average. Retry and dispute treatment is not published.",
      "claims": [
        {
          "claim_id": "vendor_outcome_language",
          "text": "The vendor describes the plan as outcome pricing."
        },
        {
          "claim_id": "action_equals_resolution",
          "text": "Every billed standard action is a verified customer resolution."
        }
      ],
      "claim_labels": {
        "vendor_outcome_language": "The vendor describes the plan as outcome pricing.",
        "action_equals_resolution": "Every billed standard action is a verified customer resolution."
      },
      "response": {
        "case_id": "action-vs-outcome",
        "claim_assessments": [
          {
            "claim_id": "vendor_outcome_language",
            "state": "COMPANY_CLAIM"
          },
          {
            "claim_id": "action_equals_resolution",
            "state": "CONTRADICTED"
          }
        ],
        "decision": "REJECT",
        "memo": "Do not treat each billed standard action as a verified customer resolution. The package price is $0.005 per credit, so a 20-credit action costs $0.10. At the historical average of three actions per resolution, the action charge is $0.30 per historical resolution. The history directly contradicts a one-action-equals-one-resolution assumption, and unpublished retry and dispute treatment creates additional cost uncertainty. The vendor’s “outcome pricing” description is marketing language, not evidence of verified resolutions.",
        "next_question": "NONE - evidence sufficient",
        "primary_metric": {
          "label": "action charge at the historical average actions per resolution",
          "unit": "USD_PER_HISTORICAL_RESOLUTION",
          "value": 0.3
        }
      }
    },
    {
      "item_id": "review-04",
      "response_label": "RESPONSE 04",
      "case_id": "cap-vs-value",
      "route_key": "proposed",
      "decision_question": "Should finance approve the project as value-positive from the supplied evidence?",
      "situation": "A project ran 100 jobs. Provider cost was $800, 30 results were accepted, and reviewers spent 10 hours at $60 per hour. The project had a $1,000 provider-spend cap and did not cross it. Shared infrastructure was zero. No value per accepted result or approved cost threshold was supplied.",
      "claims": [
        {
          "claim_id": "under_cap",
          "text": "Provider spend remained below the project cap."
        },
        {
          "claim_id": "work_was_worth_running",
          "text": "The project was worth running."
        }
      ],
      "claim_labels": {
        "under_cap": "Provider spend remained below the project cap.",
        "work_was_worth_running": "The project was worth running."
      },
      "response": {
        "case_id": "cap-vs-value",
        "claim_assessments": [
          {
            "claim_id": "under_cap",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "work_was_worth_running",
            "state": "UNKNOWN"
          }
        ],
        "decision": "INVESTIGATE",
        "memo": "Provider spend was $800, below the $1,000 cap, so the cap claim is verified. However, total supplied cost was $1,400: $800 provider cost plus $600 reviewer time. With 30 accepted results, recurring cost per accepted result is $46.67 on provider cost alone or $286.67 including reviewer time. The supplied evidence gives no value per accepted result or approved threshold, so finance cannot conclude that the project was value-positive.",
        "next_question": "What value does finance assign to each accepted result, or what approved cost-per-accepted-result threshold should be applied?",
        "primary_metric": {
          "label": "recurring cost per accepted result",
          "unit": "USD_PER_ACCEPTED_RESULT",
          "value": 286.67
        }
      }
    },
    {
      "item_id": "review-05",
      "response_label": "RESPONSE 05",
      "case_id": "retry-economics",
      "route_key": "baseline",
      "decision_question": "Can finance approve Route A as the cheaper all-in route from the supplied evidence?",
      "situation": "Route A attempts 100 jobs using 130 total model requests at $0.02 per request and produces 90 accepted results. Route B attempts the same 100 jobs using 105 requests at $0.03 per request and produces 95 accepted results. Human correction time was not measured.",
      "claims": [
        {
          "claim_id": "a_provider_unit_cost",
          "text": "Route A's observed provider cost per accepted result is about $0.0289."
        },
        {
          "claim_id": "a_all_in_cheaper",
          "text": "Route A is cheaper after all required human work."
        }
      ],
      "claim_labels": {
        "a_provider_unit_cost": "Route A's observed provider cost per accepted result is about $0.0289.",
        "a_all_in_cheaper": "Route A is cheaper after all required human work."
      },
      "response": {
        "case_id": "retry-economics",
        "claim_assessments": [
          {
            "claim_id": "a_provider_unit_cost",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "a_all_in_cheaper",
            "state": "UNKNOWN"
          }
        ],
        "decision": "INVESTIGATE",
        "memo": "Route A's provider spend is $2.60 for 90 accepted results, or about $0.0289 per accepted result. However, finance cannot approve Route A as the cheaper all-in route because human correction time was not measured. Provider cost alone does not establish total cost after required human work.",
        "next_question": "What human correction time and labor cost per accepted result does each route require?",
        "primary_metric": {
          "label": "Route A provider cost per accepted result",
          "unit": "USD_PER_ACCEPTED_RESULT",
          "value": 0.02888888888888889
        }
      }
    },
    {
      "item_id": "review-06",
      "response_label": "RESPONSE 06",
      "case_id": "cache-reuse",
      "route_key": "proposed",
      "decision_question": "Should finance approve a claim that caching makes the entire workflow 32.5% cheaper?",
      "situation": "A stable 100,000-token prefix is used in two requests inside the cache time-to-live. Standard input costs $2.00 per million tokens. A cache write costs $2.50 per million and a cache read costs $0.20 per million. Output, tools, retries, and human correction are excluded from this bounded calculation.",
      "claims": [
        {
          "claim_id": "bounded_reduction",
          "text": "Caching lowers the repeated-input portion from $0.40 to $0.27."
        },
        {
          "claim_id": "whole_workflow_reduction",
          "text": "The entire workflow becomes 32.5% cheaper."
        }
      ],
      "claim_labels": {
        "bounded_reduction": "Caching lowers the repeated-input portion from $0.40 to $0.27.",
        "whole_workflow_reduction": "The entire workflow becomes 32.5% cheaper."
      },
      "response": {
        "case_id": "cache-reuse",
        "claim_assessments": [
          {
            "claim_id": "bounded_reduction",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "whole_workflow_reduction",
            "state": "CONTRADICTED"
          }
        ],
        "decision": "REJECT",
        "memo": "For the two-request, 100,000-token repeated-input portion, uncached cost is $0.40. With caching, the write costs $0.25 and the read costs $0.02, for a total of $0.27. The verified reduction is therefore ($0.40 - $0.27) / $0.40 = 32.5%. However, the evidence covers only the bounded repeated-input calculation and explicitly excludes output, tools, retries, and human correction. It does not support claiming that the entire workflow is 32.5% cheaper. Finance should reject approval of the whole-workflow claim.",
        "next_question": "NONE - evidence sufficient",
        "primary_metric": {
          "label": "bounded repeated-input cost reduction",
          "unit": "PERCENT",
          "value": 32.5
        }
      }
    },
    {
      "item_id": "review-07",
      "response_label": "RESPONSE 07",
      "case_id": "benchmark-scope",
      "route_key": "baseline",
      "decision_question": "Should finance approve the vendor's 3x result for the target-workload forecast now?",
      "situation": "A vendor reports that its system is 3 times faster in an official 8,000-input-token, 1,000-output-token benchmark using a warm cache and vendor-selected hardware. The target workload uses 120,000-token agent sessions with cold starts. No independent reproduction is available.",
      "claims": [
        {
          "claim_id": "vendor_result",
          "text": "The vendor reported a 3 times result in the stated benchmark."
        },
        {
          "claim_id": "target_result",
          "text": "The target long-context workload will also run 3 times faster."
        }
      ],
      "claim_labels": {
        "vendor_result": "The vendor reported a 3 times result in the stated benchmark.",
        "target_result": "The target long-context workload will also run 3 times faster."
      },
      "response": {
        "case_id": "benchmark-scope",
        "claim_assessments": [
          {
            "claim_id": "vendor_result",
            "state": "COMPANY_CLAIM"
          },
          {
            "claim_id": "target_result",
            "state": "UNKNOWN"
          }
        ],
        "decision": "INVESTIGATE",
        "memo": "The target has 15 times the benchmark's input-token volume (120,000 ÷ 8,000). The vendor's reported 3x benchmark result is not independently reproduced, and the benchmark differs materially from the target workload: warm cache versus cold starts, vendor-selected hardware, and much shorter context. Finance should not use the 3x result in the target-workload forecast until its applicability is tested.",
        "next_question": "What independently reproduced performance result is achieved on 120,000-token agent sessions with cold starts using the target deployment hardware and configuration?",
        "primary_metric": {
          "label": "target-to-benchmark input-token ratio",
          "unit": "MULTIPLIER",
          "value": 15
        }
      }
    },
    {
      "item_id": "review-08",
      "response_label": "RESPONSE 08",
      "case_id": "human-cost-reversal",
      "route_key": "proposed",
      "decision_question": "Should finance choose Route A over Route B on recurring cost per accepted result?",
      "situation": "Route A has $100 of model cost and requires 30 reviewer hours at $60 per hour. Route B has $400 of model cost and requires 5 reviewer hours at the same rate. Both routes produce 100 accepted results. Shared infrastructure is zero.",
      "claims": [
        {
          "claim_id": "a_model_cheaper",
          "text": "Route A has the lower model bill."
        },
        {
          "claim_id": "a_recurring_cheaper",
          "text": "Route A has the lower recurring cost after required review."
        }
      ],
      "claim_labels": {
        "a_model_cheaper": "Route A has the lower model bill.",
        "a_recurring_cheaper": "Route A has the lower recurring cost after required review."
      },
      "response": {
        "case_id": "human-cost-reversal",
        "claim_assessments": [
          {
            "claim_id": "a_model_cheaper",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "a_recurring_cheaper",
            "state": "CONTRADICTED"
          }
        ],
        "decision": "REJECT",
        "memo": "Route A does have the lower model bill: $100 versus $400. But required review reverses the result. Route A costs $1,800 in review labor (30 × $60), for total recurring cost of $1,900. Route B costs $300 in review labor (5 × $60), for total recurring cost of $700. For 100 accepted results, Route A is therefore $1,200 more expensive than Route B, not $1,500. The supplied economics directly show that Route A is worse on recurring cost.",
        "next_question": "NONE - evidence sufficient",
        "primary_metric": {
          "label": "Route A recurring cost premium for 100 accepted results",
          "unit": "USD_PER_100_ACCEPTED_RESULTS",
          "value": 1500
        }
      }
    },
    {
      "item_id": "review-09",
      "response_label": "RESPONSE 09",
      "case_id": "rate-vs-tokenizer",
      "route_key": "baseline",
      "decision_question": "Should finance approve a forecast claiming that the candidate will reduce the equivalent workload's all-in cost by one third?",
      "situation": "The current model processes 1,000,000 input tokens for an equivalent monthly workload at $3.00 per million input tokens. A candidate model charges $2.00 per million, but its tokenizer produces 30% more input tokens for the same work. Output volume, quality, retries, and correction time have not been tested.",
      "claims": [
        {
          "claim_id": "lower_rate",
          "text": "The candidate input-token rate is lower."
        },
        {
          "claim_id": "one_third_all_in_savings",
          "text": "The equivalent workload's all-in cost will be one third lower."
        }
      ],
      "claim_labels": {
        "lower_rate": "The candidate input-token rate is lower.",
        "one_third_all_in_savings": "The equivalent workload's all-in cost will be one third lower."
      },
      "response": {
        "case_id": "rate-vs-tokenizer",
        "claim_assessments": [
          {
            "claim_id": "lower_rate",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "one_third_all_in_savings",
            "state": "UNKNOWN"
          }
        ],
        "decision": "INVESTIGATE",
        "memo": "The candidate's listed input-token rate is lower, but tokenizer expansion raises equivalent-workload input volume to 1.3 million tokens. At $2.00 per million, candidate input cost is $2.60 versus $3.00 currently. That is about 13.3% lower, not enough to establish one-third all-in savings. Because output volume, quality, retries, and correction time remain untested, the all-in forecast is not decision-ready.",
        "next_question": "What are the candidate's measured output-token cost, retry rate, quality-related correction time, and other operating costs for the equivalent workload?",
        "primary_metric": {
          "label": "candidate input cost for the equivalent workload",
          "unit": "USD_PER_WORKLOAD",
          "value": 2.6
        }
      }
    },
    {
      "item_id": "review-10",
      "response_label": "RESPONSE 10",
      "case_id": "commitment-exposure",
      "route_key": "proposed",
      "decision_question": "Should finance continue describing the commitment as savings compared with the workload's current on-demand cost?",
      "situation": "A team expects $10,000 of monthly on-demand agent usage and accepts a three-year commitment priced 20% below on-demand, creating an $8,000 monthly committed spend. Six months later, the same workload would cost $6,000 per month on demand. The commitment cannot be reduced during the term.",
      "claims": [
        {
          "claim_id": "discount_exists",
          "text": "The original committed price was 20% below the original on-demand forecast."
        },
        {
          "claim_id": "commitment_still_saves",
          "text": "The commitment is still saving money compared with the workload's current on-demand cost."
        }
      ],
      "claim_labels": {
        "discount_exists": "The original committed price was 20% below the original on-demand forecast.",
        "commitment_still_saves": "The commitment is still saving money compared with the workload's current on-demand cost."
      },
      "response": {
        "case_id": "commitment-exposure",
        "claim_assessments": [
          {
            "claim_id": "discount_exists",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "commitment_still_saves",
            "state": "CONTRADICTED"
          }
        ],
        "decision": "REJECT",
        "memo": "Do not continue describing the commitment as savings against the workload's current on-demand cost. The committed spend is $8,000 per month, while current on-demand cost is $6,000, creating a $2,000 monthly premium. The original 20% discount was real against the original $10,000 forecast, but it does not establish savings today. Because the commitment cannot be reduced, this unfavorable economics is locked in for the remaining term.",
        "next_question": "NONE - evidence sufficient",
        "primary_metric": {
          "label": "commitment premium over current on-demand cost",
          "unit": "USD_PER_MONTH",
          "value": 2000
        }
      }
    },
    {
      "item_id": "review-11",
      "response_label": "RESPONSE 11",
      "case_id": "currency-boundary",
      "route_key": "proposed",
      "decision_question": "Can finance approve Route B as cheaper than Route A from the supplied evidence?",
      "situation": "Route A cost $900 USD. Route B cost EUR 800. No exchange-rate source, rate, or effective date was recorded. Work volume and accepted-result counts were equal.",
      "claims": [
        {
          "claim_id": "two_observed_costs",
          "text": "The two observed provider amounts are 900 USD and 800 EUR."
        },
        {
          "claim_id": "b_cheaper",
          "text": "Route B is cheaper after converting both observed costs to one currency."
        }
      ],
      "claim_labels": {
        "two_observed_costs": "The two observed provider amounts are 900 USD and 800 EUR.",
        "b_cheaper": "Route B is cheaper after converting both observed costs to one currency."
      },
      "response": {
        "case_id": "currency-boundary",
        "claim_assessments": [
          {
            "claim_id": "two_observed_costs",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "b_cheaper",
            "state": "UNKNOWN"
          }
        ],
        "decision": "INVESTIGATE",
        "memo": "Finance cannot approve Route B as cheaper because the observed amounts are denominated in different currencies and no exchange rate or effective date was recorded. Equal work volume and accepted-result counts do not resolve the currency comparison. The normalized provider cost difference is therefore unavailable.",
        "next_question": "What exchange rate and effective date should be used to convert the EUR 800 cost into USD?",
        "primary_metric": {
          "label": "normalized provider cost difference",
          "unit": "UNAVAILABLE",
          "value": null
        }
      }
    },
    {
      "item_id": "review-12",
      "response_label": "RESPONSE 12",
      "case_id": "retention-gate",
      "route_key": "baseline",
      "decision_question": "Should the candidate model be approved for this workload under the current policy?",
      "situation": "The workload policy permits zero-day provider retention. A candidate model has a mandatory 30-day retention period and a model rate 40% below the approved route. No policy exception has been granted.",
      "claims": [
        {
          "claim_id": "rate_lower",
          "text": "The candidate model rate is 40% lower."
        },
        {
          "claim_id": "policy_eligible",
          "text": "The candidate is eligible for this workload under the stated policy."
        }
      ],
      "claim_labels": {
        "rate_lower": "The candidate model rate is 40% lower.",
        "policy_eligible": "The candidate is eligible for this workload under the stated policy."
      },
      "response": {
        "case_id": "retention-gate",
        "claim_assessments": [
          {
            "claim_id": "rate_lower",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "policy_eligible",
            "state": "CONTRADICTED"
          }
        ],
        "decision": "REJECT",
        "memo": "Reject the candidate under the current policy. Its mandatory 30-day retention period is 30 days above the zero-day allowance, and no exception has been granted. The stated 40% lower model rate does not override the retention requirement or establish all-in savings.",
        "next_question": "NONE - evidence sufficient",
        "primary_metric": {
          "label": "retention period above the policy allowance",
          "unit": "DAYS",
          "value": 30
        }
      }
    },
    {
      "item_id": "review-13",
      "response_label": "RESPONSE 13",
      "case_id": "action-vs-outcome",
      "route_key": "proposed",
      "decision_question": "Should procurement treat each billed standard action as a verified customer resolution when comparing costs?",
      "situation": "A vendor sells 100,000 flex credits for $500 and describes the plan as outcome pricing. One standard agent action consumes 20 credits. Historical cases use three actions before resolution on average. Retry and dispute treatment is not published.",
      "claims": [
        {
          "claim_id": "vendor_outcome_language",
          "text": "The vendor describes the plan as outcome pricing."
        },
        {
          "claim_id": "action_equals_resolution",
          "text": "Every billed standard action is a verified customer resolution."
        }
      ],
      "claim_labels": {
        "vendor_outcome_language": "The vendor describes the plan as outcome pricing.",
        "action_equals_resolution": "Every billed standard action is a verified customer resolution."
      },
      "response": {
        "case_id": "action-vs-outcome",
        "claim_assessments": [
          {
            "claim_id": "vendor_outcome_language",
            "state": "COMPANY_CLAIM"
          },
          {
            "claim_id": "action_equals_resolution",
            "state": "CONTRADICTED"
          }
        ],
        "decision": "INVESTIGATE",
        "memo": "The vendor’s outcome-pricing description is only a company claim. The supplied history shows three standard actions per resolution on average, so one action is not equivalent to one resolution. At $500 for 100,000 credits and 20 credits per action, each action costs $0.10; at the historical average, the action charge is $0.30 per resolution. Retry and dispute treatment is unpublished, so procurement should not treat each billed action as a verified customer resolution or make a decision-ready cost comparison yet.",
        "next_question": "What are the vendor’s retry, dispute, and verification rules for billed actions, and can they be reconciled to independently verified customer resolutions?",
        "primary_metric": {
          "label": "action charge at the historical average actions per resolution",
          "unit": "USD_PER_HISTORICAL_RESOLUTION",
          "value": 0.3
        }
      }
    },
    {
      "item_id": "review-14",
      "response_label": "RESPONSE 14",
      "case_id": "cap-vs-value",
      "route_key": "baseline",
      "decision_question": "Should finance approve the project as value-positive from the supplied evidence?",
      "situation": "A project ran 100 jobs. Provider cost was $800, 30 results were accepted, and reviewers spent 10 hours at $60 per hour. The project had a $1,000 provider-spend cap and did not cross it. Shared infrastructure was zero. No value per accepted result or approved cost threshold was supplied.",
      "claims": [
        {
          "claim_id": "under_cap",
          "text": "Provider spend remained below the project cap."
        },
        {
          "claim_id": "work_was_worth_running",
          "text": "The project was worth running."
        }
      ],
      "claim_labels": {
        "under_cap": "Provider spend remained below the project cap.",
        "work_was_worth_running": "The project was worth running."
      },
      "response": {
        "case_id": "cap-vs-value",
        "claim_assessments": [
          {
            "claim_id": "under_cap",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "work_was_worth_running",
            "state": "UNKNOWN"
          }
        ],
        "decision": "INVESTIGATE",
        "memo": "Recurring cost was $1,400: $800 of provider spend plus $600 of reviewer labor. Across 30 accepted results, that is $46.67 per accepted result. Provider spend was under the $1,000 cap, but staying under a provider-spend cap does not establish that the project was value-positive. Finance cannot approve the project as value-positive without a value per accepted result or an approved cost threshold.",
        "next_question": "What is the approved maximum cost per accepted result, or the validated financial value of each accepted result?",
        "primary_metric": {
          "label": "recurring cost per accepted result",
          "unit": "USD_PER_ACCEPTED_RESULT",
          "value": 46.6666666667
        }
      }
    },
    {
      "item_id": "review-15",
      "response_label": "RESPONSE 15",
      "case_id": "retry-economics",
      "route_key": "proposed",
      "decision_question": "Can finance approve Route A as the cheaper all-in route from the supplied evidence?",
      "situation": "Route A attempts 100 jobs using 130 total model requests at $0.02 per request and produces 90 accepted results. Route B attempts the same 100 jobs using 105 requests at $0.03 per request and produces 95 accepted results. Human correction time was not measured.",
      "claims": [
        {
          "claim_id": "a_provider_unit_cost",
          "text": "Route A's observed provider cost per accepted result is about $0.0289."
        },
        {
          "claim_id": "a_all_in_cheaper",
          "text": "Route A is cheaper after all required human work."
        }
      ],
      "claim_labels": {
        "a_provider_unit_cost": "Route A's observed provider cost per accepted result is about $0.0289.",
        "a_all_in_cheaper": "Route A is cheaper after all required human work."
      },
      "response": {
        "case_id": "retry-economics",
        "claim_assessments": [
          {
            "claim_id": "a_provider_unit_cost",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "a_all_in_cheaper",
            "state": "UNKNOWN"
          }
        ],
        "decision": "INVESTIGATE",
        "memo": "Route A's provider cost is $2.60 for 130 requests, divided by 90 accepted results, or approximately $0.0289 per accepted result. However, Route A's all-in cost cannot be established because human correction time was not measured. Finance should not approve the claim that Route A is the cheaper all-in route based on provider rates alone.",
        "next_question": "What are the measured human correction times and costs for Routes A and B?",
        "primary_metric": {
          "label": "Route A provider cost per accepted result",
          "unit": "USD_PER_ACCEPTED_RESULT",
          "value": 0.02888888888888889
        }
      }
    },
    {
      "item_id": "review-16",
      "response_label": "RESPONSE 16",
      "case_id": "cache-reuse",
      "route_key": "baseline",
      "decision_question": "Should finance approve a claim that caching makes the entire workflow 32.5% cheaper?",
      "situation": "A stable 100,000-token prefix is used in two requests inside the cache time-to-live. Standard input costs $2.00 per million tokens. A cache write costs $2.50 per million and a cache read costs $0.20 per million. Output, tools, retries, and human correction are excluded from this bounded calculation.",
      "claims": [
        {
          "claim_id": "bounded_reduction",
          "text": "Caching lowers the repeated-input portion from $0.40 to $0.27."
        },
        {
          "claim_id": "whole_workflow_reduction",
          "text": "The entire workflow becomes 32.5% cheaper."
        }
      ],
      "claim_labels": {
        "bounded_reduction": "Caching lowers the repeated-input portion from $0.40 to $0.27.",
        "whole_workflow_reduction": "The entire workflow becomes 32.5% cheaper."
      },
      "response": {
        "case_id": "cache-reuse",
        "claim_assessments": [
          {
            "claim_id": "bounded_reduction",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "whole_workflow_reduction",
            "state": "UNKNOWN"
          }
        ],
        "decision": "REJECT",
        "memo": "For the repeated 100,000-token prefix, standard input costs $0.40 across two requests. Caching costs $0.25 for the write plus $0.02 for the read, or $0.27 total. That is a verified 32.5% reduction for this bounded repeated-input cost. Finance should not approve the same percentage as an entire-workflow reduction because output, tools, retries, and human correction are excluded; the evidence does not establish their costs or whether caching changes them.",
        "next_question": "What are the all-in workflow costs with and without caching, including output, tools, retries, and human correction?",
        "primary_metric": {
          "label": "bounded repeated-input cost reduction",
          "unit": "PERCENT",
          "value": 32.5
        }
      }
    },
    {
      "item_id": "review-17",
      "response_label": "RESPONSE 17",
      "case_id": "benchmark-scope",
      "route_key": "proposed",
      "decision_question": "Should finance approve the vendor's 3x result for the target-workload forecast now?",
      "situation": "A vendor reports that its system is 3 times faster in an official 8,000-input-token, 1,000-output-token benchmark using a warm cache and vendor-selected hardware. The target workload uses 120,000-token agent sessions with cold starts. No independent reproduction is available.",
      "claims": [
        {
          "claim_id": "vendor_result",
          "text": "The vendor reported a 3 times result in the stated benchmark."
        },
        {
          "claim_id": "target_result",
          "text": "The target long-context workload will also run 3 times faster."
        }
      ],
      "claim_labels": {
        "vendor_result": "The vendor reported a 3 times result in the stated benchmark.",
        "target_result": "The target long-context workload will also run 3 times faster."
      },
      "response": {
        "case_id": "benchmark-scope",
        "claim_assessments": [
          {
            "claim_id": "vendor_result",
            "state": "COMPANY_CLAIM"
          },
          {
            "claim_id": "target_result",
            "state": "UNKNOWN"
          }
        ],
        "decision": "INVESTIGATE",
        "memo": "The vendor's 3x result is a company claim from an 8,000-input-token benchmark using a warm cache and vendor-selected hardware. The target workload is 120,000 input tokens with cold starts, 15x the benchmark input size, and materially different operating conditions. With no independent reproduction, the benchmark does not establish that the target workload will also be 3x faster. Finance should not approve the forecast until target-like testing or other evidence validates the result.",
        "next_question": "Can the vendor provide an independent, target-like reproduction using 120,000-token sessions, cold starts, and comparable hardware?",
        "primary_metric": {
          "label": "target-to-benchmark input-token ratio",
          "unit": "MULTIPLIER",
          "value": 15
        }
      }
    },
    {
      "item_id": "review-18",
      "response_label": "RESPONSE 18",
      "case_id": "human-cost-reversal",
      "route_key": "baseline",
      "decision_question": "Should finance choose Route A over Route B on recurring cost per accepted result?",
      "situation": "Route A has $100 of model cost and requires 30 reviewer hours at $60 per hour. Route B has $400 of model cost and requires 5 reviewer hours at the same rate. Both routes produce 100 accepted results. Shared infrastructure is zero.",
      "claims": [
        {
          "claim_id": "a_model_cheaper",
          "text": "Route A has the lower model bill."
        },
        {
          "claim_id": "a_recurring_cheaper",
          "text": "Route A has the lower recurring cost after required review."
        }
      ],
      "claim_labels": {
        "a_model_cheaper": "Route A has the lower model bill.",
        "a_recurring_cheaper": "Route A has the lower recurring cost after required review."
      },
      "response": {
        "case_id": "human-cost-reversal",
        "claim_assessments": [
          {
            "claim_id": "a_model_cheaper",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "a_recurring_cheaper",
            "state": "CONTRADICTED"
          }
        ],
        "decision": "REJECT",
        "memo": "Do not choose Route A on recurring cost. For 100 accepted results, Route A costs $1,900: $100 of model cost plus $1,800 of review. Route B costs $700: $400 of model cost plus $300 of review. Although Route A's model bill is $300 lower, its required review makes its total recurring cost $1,200 higher per 100 accepted results.",
        "next_question": "NONE - evidence sufficient",
        "primary_metric": {
          "label": "Route A recurring cost premium for 100 accepted results",
          "unit": "USD_PER_100_ACCEPTED_RESULTS",
          "value": 1200
        }
      }
    },
    {
      "item_id": "review-19",
      "response_label": "RESPONSE 19",
      "case_id": "rate-vs-tokenizer",
      "route_key": "proposed",
      "decision_question": "Should finance approve a forecast claiming that the candidate will reduce the equivalent workload's all-in cost by one third?",
      "situation": "The current model processes 1,000,000 input tokens for an equivalent monthly workload at $3.00 per million input tokens. A candidate model charges $2.00 per million, but its tokenizer produces 30% more input tokens for the same work. Output volume, quality, retries, and correction time have not been tested.",
      "claims": [
        {
          "claim_id": "lower_rate",
          "text": "The candidate input-token rate is lower."
        },
        {
          "claim_id": "one_third_all_in_savings",
          "text": "The equivalent workload's all-in cost will be one third lower."
        }
      ],
      "claim_labels": {
        "lower_rate": "The candidate input-token rate is lower.",
        "one_third_all_in_savings": "The equivalent workload's all-in cost will be one third lower."
      },
      "response": {
        "case_id": "rate-vs-tokenizer",
        "claim_assessments": [
          {
            "claim_id": "lower_rate",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "one_third_all_in_savings",
            "state": "CONTRADICTED"
          }
        ],
        "decision": "REJECT",
        "memo": "Reject the forecast as stated. The candidate’s rate is lower, but its 30% higher tokenization means the equivalent workload uses 1.3 million input tokens. At $2.00 per million, candidate input cost is $2.60 versus $3.00 currently, only $0.40 lower, or about 13.3%, not one third. Output volume, quality, retries, and correction time are untested, so the all-in claim is not supported and could be worse after those factors.",
        "next_question": "NONE - evidence sufficient",
        "primary_metric": {
          "label": "candidate input cost for the equivalent workload",
          "unit": "USD_PER_WORKLOAD",
          "value": 2.6
        }
      }
    },
    {
      "item_id": "review-20",
      "response_label": "RESPONSE 20",
      "case_id": "commitment-exposure",
      "route_key": "baseline",
      "decision_question": "Should finance continue describing the commitment as savings compared with the workload's current on-demand cost?",
      "situation": "A team expects $10,000 of monthly on-demand agent usage and accepts a three-year commitment priced 20% below on-demand, creating an $8,000 monthly committed spend. Six months later, the same workload would cost $6,000 per month on demand. The commitment cannot be reduced during the term.",
      "claims": [
        {
          "claim_id": "discount_exists",
          "text": "The original committed price was 20% below the original on-demand forecast."
        },
        {
          "claim_id": "commitment_still_saves",
          "text": "The commitment is still saving money compared with the workload's current on-demand cost."
        }
      ],
      "claim_labels": {
        "discount_exists": "The original committed price was 20% below the original on-demand forecast.",
        "commitment_still_saves": "The commitment is still saving money compared with the workload's current on-demand cost."
      },
      "response": {
        "case_id": "commitment-exposure",
        "claim_assessments": [
          {
            "claim_id": "discount_exists",
            "state": "VERIFIED_FACT"
          },
          {
            "claim_id": "commitment_still_saves",
            "state": "CONTRADICTED"
          }
        ],
        "decision": "REJECT",
        "memo": "Finance should not continue describing the commitment as savings versus the workload's current on-demand cost. The original commitment was $8,000 per month, which was 20% below the original $10,000 forecast. However, the workload now costs $6,000 per month on demand, so the fixed commitment carries a $2,000 monthly premium rather than generating current savings.",
        "next_question": "NONE - evidence sufficient",
        "primary_metric": {
          "label": "commitment premium over current on-demand cost",
          "unit": "USD_PER_MONTH",
          "value": 2000
        }
      }
    }
  ]
};
