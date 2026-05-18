from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "check_workflow_compliance.py"
EXAMPLE = ROOT / "assets" / "workflow-run-record.example.json"
DECISION_PROMPT = ROOT / "references" / "prompts" / "decision-synthesis.md"


def run_checker(tmp_path: Path, payload: dict, *extra_args: str) -> subprocess.CompletedProcess[str]:
    record = tmp_path / "run-record.json"
    record.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--input", str(record), *extra_args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def load_example() -> dict:
    return json.loads(EXAMPLE.read_text(encoding="utf-8"))


def test_example_run_record_is_compliant(tmp_path: Path) -> None:
    result = run_checker(tmp_path, load_example(), "--strict")
    assert result.returncode == 0, result.stdout + result.stderr
    payload = json.loads(result.stdout)
    assert payload["compliant"] is True
    assert payload["errors"] == []


def test_missing_manifest_read_is_non_compliant(tmp_path: Path) -> None:
    payload = load_example()
    payload["required_reads"] = [
        "references/evidence-contract.md",
        "references/dag-workflow.md",
        "references/report-standard.md",
    ]
    result = run_checker(tmp_path, payload, "--strict")
    assert result.returncode == 1
    report = json.loads(result.stdout)
    assert "references/workflow-manifest.json" in report["missing_reads"]


def test_concurrency_without_independent_dispatch_uses_fallback(tmp_path: Path) -> None:
    payload = load_example()
    payload["runtime"] = {
        "supports_independent_task_execution": False,
        "supports_concurrent_role_workers": True,
        "supports_structured_artifact_return": True,
    }
    payload["dispatched_nodes"] = []
    payload["workflow_deviations"] = ["WORKFLOW_DEVIATION: no_subagent_dispatch"]
    result = run_checker(tmp_path, payload, "--strict")
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report["compliant"] is True


def test_strategy_dispatch_must_cover_every_branch(tmp_path: Path) -> None:
    payload = load_example()
    payload["executed_nodes"] = [
        "technical",
        "intel",
        "fundamentals_flow",
        "risk",
        "strategy_specialist:bull_trend",
        "strategy_specialist:shrink_pullback",
    ]
    payload["dispatched_nodes"] = [
        "technical",
        "intel",
        "fundamentals_flow",
        "risk",
        "strategy_specialist:bull_trend",
    ]
    payload["execution_order"] = [
        "technical",
        "intel",
        "fundamentals_flow",
        "risk",
        "strategy_specialist:bull_trend",
        "strategy_specialist:shrink_pullback",
    ]
    payload["strategy_branch_count"] = 2
    payload["workflow_deviations"] = []
    result = run_checker(tmp_path, payload, "--strict")
    assert result.returncode == 1
    report = json.loads(result.stdout)
    assert "strategy_specialist(1/2)" in report["missing_dispatch"]


def test_quick_mode_brief_output_is_allowed(tmp_path: Path) -> None:
    payload = load_example()
    payload["mode"] = "quick"
    payload["runtime"] = {
        "supports_independent_task_execution": False,
        "supports_concurrent_role_workers": False,
        "supports_structured_artifact_return": True,
    }
    payload["role_prompts_read"] = ["technical"]
    payload["executed_nodes"] = ["technical"]
    payload["dispatched_nodes"] = []
    payload["execution_order"] = ["technical"]
    payload["output_variant"] = "brief_summary_report"
    payload["deliverable_order"] = [
        "brief_summary_report",
        "decision_dashboard_json",
        "evidence_audit_appendix",
    ]
    payload["workflow_deviations"] = []
    payload["strategy_branch_count"] = 0
    result = run_checker(tmp_path, payload, "--strict")
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report["compliant"] is True


def test_invalid_dashboard_schema_is_reported(tmp_path: Path) -> None:
    payload = load_example()
    payload["decision_dashboard"].pop("evidence_quality")
    payload["workflow_deviations"] = ["WORKFLOW_DEVIATION: decision_dashboard_missing"]
    result = run_checker(tmp_path, payload, "--strict")
    assert result.returncode == 1
    report = json.loads(result.stdout)
    assert report["compliant"] is False
    assert report["dashboard_schema_errors"]
    assert "WORKFLOW_DEVIATION: decision_dashboard_missing" in report["required_workflow_deviations"]


def test_decision_prompt_no_longer_claims_json_is_the_only_output() -> None:
    text = DECISION_PROMPT.read_text(encoding="utf-8")
    assert "Return a valid JSON object" not in text
    assert "required artifact inside the final deliverable package" in text
    assert "A Markdown primary report" in text


def test_print_example_outputs_valid_json() -> None:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--print-example"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["mode"] == "specialist"
