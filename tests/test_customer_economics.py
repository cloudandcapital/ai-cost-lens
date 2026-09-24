"""Customer cost to serve and evidence planning must keep missing records visible."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def node_json(code):
    result = subprocess.run(
        ["node", "-e", code], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return json.loads(result.stdout)


@pytest.mark.skipif(shutil.which("node") is None, reason="node unavailable")
def test_customer_cost_excludes_unmatched_and_partial_cost():
    result = node_json("""
      const engine=require('./web/customer-economics-engine');
      const review={currency:'USD',spend:{period:{start:'2026-09-01',end:'2026-09-30'}},events:[
        {customer:'A',currency:'USD',selected_cost:60,cost_basis:'provider_reported'},
        {customer:'A',currency:'USD',selected_cost:null,cost_basis:'unpriced'},
        {customer:'B',currency:'USD',selected_cost:130,cost_basis:'calculated'},
        {customer:'C',currency:'USD',selected_cost:10,cost_basis:'calculated'},
        {customer:null,currency:'USD',selected_cost:15,cost_basis:'calculated'}]};
      const rows=['A','B'].map(customer=>({customer,period_start:'2026-09-01',period_end:'2026-09-30',revenue:'100',currency:'USD'}));
      console.log(JSON.stringify(engine.analyze(review,rows)));
    """)
    assert result["customers"][0]["customer"] == "B"
    assert result["customers"][0]["ai_cost_share"] == 1.3
    assert result["customers"][0]["revenue_after_ai_requests"] == -30
    assert result["customers"][1]["ai_cost_share"] is None
    assert result["customers"][1]["revenue_after_ai_requests"] is None
    assert result["unallocated_cost"] == 15
    assert result["unmatched_cost"] == 10
    assert result["unpriced_requests"] == 1


@pytest.mark.skipif(shutil.which("node") is None, reason="node unavailable")
def test_revenue_period_and_duplicate_customers_are_rejected():
    result = node_json("""
      const engine=require('./web/customer-economics-engine');
      const review={currency:'USD',spend:{period:{start:'2026-09-01',end:'2026-09-30'}},events:[{customer:'A',selected_cost:5}]};
      const row={customer:'A',period_start:'2026-09-01',period_end:'2026-09-30',currency:'USD',revenue:'20'};
      function error(rows){try{engine.analyze(review,rows);return null}catch(e){return e.message}}
      console.log(JSON.stringify([error([{...row,period_end:'2026-09-29'}]),error([row,row]),error([{...row,currency:'EUR'}])]));
    """)
    assert "UTC period" in result[0]
    assert "repeats customer" in result[1]
    assert "USD" in result[2]


@pytest.mark.skipif(shutil.which("node") is None, reason="node unavailable")
def test_evidence_kit_and_precision_guide():
    result = node_json("""
      const e=require('./web/evidence-tools');
      const route={evidence:{cost_basis:'calculated',coverage_status:'sampled',reconciliation_issues:[]},outcomes:{basis:'sampled'},policy:{approved:false}};
      const review={mode:'illustrative',baseline:route,proposed:route,comparison:{same_cost_basis:true,quality_holds:false}};
      console.log(JSON.stringify({tasks:e.evidenceKit(review),n:e.sampleSize(5),wide:e.sampleSize(10)}));
    """)
    keys = {item["key"] for item in result["tasks"]}
    assert {
        "own-records",
        "Current route-policy",
        "Candidate route-sample",
        "quality",
    } <= keys
    assert result["n"] == 385
    assert result["wide"] == 97


@pytest.mark.skipif(shutil.which("node") is None, reason="node unavailable")
def test_customer_join_keeps_known_cost_when_a_row_is_unpriced_or_other_currency():
    result = node_json("""
      const engine=require('./web/customer-economics-engine');
      const review={currency:'MIXED',spend:{period:{start:'2026-09-01',end:'2026-09-30'}},events:[
        {customer:'A',currency:'USD',selected_cost:40,cost_basis:'provider_reported'},
        {customer:'A',currency:'USD',selected_cost:null,cost_basis:'unpriced'},
        {customer:'A',currency:'EUR',selected_cost:10,cost_basis:'provider_reported'}]};
      const rows=[{customer:'A',period_start:'2026-09-01',period_end:'2026-09-30',revenue:'100',currency:'USD'}];
      console.log(JSON.stringify(engine.analyze(review,rows)));
    """)
    assert result["customers"][0]["ai_cost_share"] is None
    assert result["customers"][0]["known_ai_cost_share_lower_bound"] == 0.4
    assert result["excluded_currency_requests"] == 1


@pytest.mark.skipif(shutil.which("node") is None, reason="node unavailable")
def test_allocated_costs_conserve_entered_total_and_unmatched_share():
    result = node_json("""
      const engine=require('./web/customer-economics-engine');
      const review={currency:'USD',spend:{period:{start:'2026-09-01',end:'2026-09-30'},cost_stack:{known_adjacent_cost:90,missing_categories:['pipeline']}},events:[
        {customer:'A',currency:'USD',selected_cost:10,cost_basis:'provider_reported'},
        {customer:'A',currency:'USD',selected_cost:10,cost_basis:'provider_reported'},
        {customer:null,currency:'USD',selected_cost:5,cost_basis:'provider_reported'}]};
      const rows=[{customer:'A',period_start:'2026-09-01',period_end:'2026-09-30',revenue:'100',currency:'USD'}];
      console.log(JSON.stringify(engine.analyze(review,rows,{allocation_method:'requests'})));
    """)
    assert result["customers"][0]["allocated_adjacent_cost"] == 60
    assert result["customers"][0]["known_ai_operating_share"] == 0.8
    assert result["unassigned_adjacent_cost"] == 30
    assert result["missing_categories"] == ["pipeline"]
