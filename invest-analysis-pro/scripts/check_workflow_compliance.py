#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST = ROOT / "references" / "workflow-manifest.json"
DEFAULT_SCHEMA = ROOT / "assets" / "decision-dashboard.schema.json"
DEFAULT_EXAMPLE = ROOT / "assets" / "workflow-run-record.example.json"

NODE_ALIASES = {
    "technical": "technical",
    "technical_analyst": "technical",
    "intel": "intel",
    "intel_analyst": "intel",
    "fundamentals_flow": "fundamentals_flow",
    "fundamentals&flow": "fundamentals_flow",
    "fundamentals-and-flow": "fundamentals_flow",
    "fundamentals_and_flow": "fundamentals_flow",
    "fundamentals-flow": "fundamentals_flow",
    "risk": "risk",
    "risk_officer": "risk",
    "strategy": "strategy_specialist",
    "strategy_specialist": "strategy_specialist",
    "portfolio": "portfolio",
    "portfolio_analyst": "portfolio",
    "decision": "decision",
}

PROMPT_ALIASES = {
    "references/prompts/technical-analyst.md": "technical",
    "references/prompts/intel-analyst.md": "intel",
    "references/prompts/fundamentals-flow-analyst.md": "fundamentals_flow",
    "references/prompts/risk-officer.md": "risk",
    "references/prompts/strategy-specialist.md": "strategy_specialist",
    "references/prompts/portfolio-analyst.md": "portfolio",
}

REPORT_VARIANTS = {
    "full_markdown_report",
    "brief_summary_report",
    "short_message_report",
}

JSON_TYPE_MAP = {
    "object": dict,
    "array": list,
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
    "null": type(None),
}


@dataclass
class ComplianceReport:
    compliant: bool = True
    mode: str = ""
    manifest_version: int | None = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    missing_reads: list[str] = field(default_factory=list)
    missing_role_prompts: list[str] = field(default_factory=list)
    missing_nodes: list[str] = field(default_factory=list)
    dependency_violations: list[str] = field(default_factory=list)
    missing_dispatch: list[str] = field(default_factory=list)
    deliverable_violations: list[str] = field(default_factory=list)
    dashboard_schema_errors: list[str] = field(default_factory=list)
    required_workflow_deviations: list[str] = field(default_factory=list)

    def fail(self, message: str) -> None:
        self.compliant = False
        self.errors.append(message)


class UsageError(Exception):
    pass


def load_json(path: Path | None, from_stdin: bool = False) -> Any:
    if from_stdin:
        return json.load(sys.stdin)
    if path is None:
        raise UsageError("an input path is required unless --stdin or --print-example is used")
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_node_id(value: str) -> str:
    key = value.strip()
    if key in PROMPT_ALIASES:
        return PROMPT_ALIASES[key]
    base = key.split(":", 1)[0]
    return NODE_ALIASES.get(base, base)


def normalize_node_list(values: list[str]) -> list[str]:
    return [normalize_node_id(v) for v in values]


def normalize_prompt_list(values: list[str]) -> list[str]:
    return [normalize_node_id(v) for v in values]


def normalize_path_list(values: list[str]) -> set[str]:
    return {str(v).strip() for v in values}


def node_count(raw_nodes: list[str], canonical: str) -> int:
    count = 0
    for item in raw_nodes:
        if normalize_node_id(item) == canonical:
            count += 1
    return count


def validate_against_schema(instance: Any, schema: dict[str, Any], path: str = "$") -> list[str]:
    errors: list[str] = []

    schema_type = schema.get("type")
    if schema_type is not None:
        allowed_types = schema_type if isinstance(schema_type, list) else [schema_type]
        if not any(isinstance(instance, JSON_TYPE_MAP[t]) and not (t == "integer" and isinstance(instance, bool)) for t in allowed_types):
            errors.append(f"{path}: expected type {allowed_types}, got {type(instance).__name__}")
            return errors

    if "enum" in schema and instance not in schema["enum"]:
        errors.append(f"{path}: expected one of {schema['enum']}, got {instance!r}")

    if isinstance(instance, str):
        min_len = schema.get("minLength")
        if min_len is not None and len(instance) < min_len:
            errors.append(f"{path}: expected minLength {min_len}, got {len(instance)}")

    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        if minimum is not None and instance < minimum:
            errors.append(f"{path}: expected >= {minimum}, got {instance}")
        if maximum is not None and instance > maximum:
            errors.append(f"{path}: expected <= {maximum}, got {instance}")

    if "oneOf" in schema:
        variants = schema["oneOf"]
        variant_errors = [validate_against_schema(instance, variant, path) for variant in variants]
        if not any(not errs for errs in variant_errors):
            errors.append(f"{path}: did not satisfy any oneOf variant")
            for group in variant_errors:
                errors.extend(group)
            return errors

    if isinstance(instance, dict):
        required = schema.get("required", [])
        for key in required:
            if key not in instance:
                errors.append(f"{path}: missing required key {key!r}")
        properties = schema.get("properties", {})
        for key, subschema in properties.items():
            if key in instance:
                errors.extend(validate_against_schema(instance[key], subschema, f"{path}.{key}"))

    if isinstance(instance, list):
        min_items = schema.get("minItems")
        if min_items is not None and len(instance) < min_items:
            errors.append(f"{path}: expected at least {min_items} items, got {len(instance)}")
        item_schema = schema.get("items")
        if item_schema:
            for idx, item in enumerate(instance):
                errors.extend(validate_against_schema(item, item_schema, f"{path}[{idx}]"))

    return errors


def build_required_nodes(manifest: dict[str, Any], mode: str, portfolio_context: bool) -> list[str]:
    mode_cfg = manifest["modes"][mode]
    nodes = list(mode_cfg.get("mandatory_nodes", []))
    if portfolio_context and "portfolio" not in nodes:
        nodes.append("portfolio")
    return nodes


def expected_primary_report(manifest: dict[str, Any], mode: str, output_variant: str | None) -> tuple[str, list[str]]:
    mode_cfg = manifest["modes"][mode]
    preferred = mode_cfg["preferred_primary_report"]
    allowed = [preferred]
    if mode_cfg["report_variant"] == "brief_or_full":
        allowed = ["brief_summary_report", "full_markdown_report"]
    if output_variant:
        return output_variant, allowed
    return preferred, allowed


def order_index_map(raw_order: list[str]) -> dict[str, int]:
    result: dict[str, int] = {}
    for idx, item in enumerate(raw_order):
        result[item] = idx
    return result


def validate_order(report: ComplianceReport, manifest: dict[str, Any], record: dict[str, Any]) -> None:
    deliverable_order = record.get("deliverable_order") or []
    primary_report, allowed_primary = expected_primary_report(manifest, report.mode, record.get("output_variant"))
    if primary_report not in allowed_primary:
        report.fail(f"output_variant {primary_report!r} is not allowed for mode {report.mode}")
        report.deliverable_violations.append("invalid_output_variant")
        return

    if primary_report not in deliverable_order:
        report.fail(f"deliverable_order is missing primary report {primary_report!r}")
        report.deliverable_violations.append("missing_primary_report")

    required_order = [primary_report, "decision_dashboard_json", "evidence_audit_appendix"]
    index = order_index_map(deliverable_order)
    missing = [name for name in required_order if name not in index]
    if missing:
        report.fail(f"deliverable_order is missing required deliverables: {', '.join(missing)}")
        report.deliverable_violations.extend([f"missing_{name}" for name in missing])
        return

    if not (index[required_order[0]] < index[required_order[1]] < index[required_order[2]]):
        report.fail("deliverable_order does not follow report -> dashboard -> appendix")
        report.deliverable_violations.append("deliverable_order_invalid")


def ensure_required_deviation(report: ComplianceReport, code: str, present: set[str]) -> None:
    if code not in report.required_workflow_deviations:
        report.required_workflow_deviations.append(code)
    if code not in present:
        report.fail(f"required workflow deviation is missing: {code}")


def validate_record(record: dict[str, Any], manifest: dict[str, Any], schema: dict[str, Any]) -> ComplianceReport:
    mode = record.get("mode")
    if mode not in manifest["modes"]:
        raise UsageError(f"unknown mode {mode!r}")

    report = ComplianceReport(mode=mode, manifest_version=manifest.get("version"))
    deviation_set = set(record.get("workflow_deviations") or [])

    required_reads = normalize_path_list(record.get("required_reads") or [])
    for path in manifest["controller"]["required_reads"]:
        if path not in required_reads:
            report.missing_reads.append(path)
    if report.missing_reads:
        report.fail("missing required controller reads: " + ", ".join(report.missing_reads))

    portfolio_context = bool(record.get("portfolio_context"))
    required_nodes = build_required_nodes(manifest, mode, portfolio_context)
    role_prompts_read = set(normalize_prompt_list(record.get("role_prompts_read") or []))
    prompt_required_nodes = [node for node in required_nodes if node != "decision"]
    for node in prompt_required_nodes:
        if node not in role_prompts_read:
            report.missing_role_prompts.append(node)
    if report.missing_role_prompts:
        report.fail("missing role-prompt reads for: " + ", ".join(report.missing_role_prompts))

    raw_executed = record.get("executed_nodes") or []
    executed = set(normalize_node_list(raw_executed))
    for node in required_nodes:
        if node == "strategy_specialist":
            continue
        if node not in executed:
            report.missing_nodes.append(node)
    strategy_bounds = manifest["modes"][mode].get("strategy_branch_count")
    if "strategy_specialist" in required_nodes:
        strategy_count = int(record.get("strategy_branch_count") or node_count(raw_executed, "strategy_specialist"))
        if strategy_bounds:
            min_count = strategy_bounds["min"]
            max_count = strategy_bounds["max"]
            if strategy_count < min_count:
                report.missing_nodes.append(f"strategy_specialist(min={min_count})")
                report.fail(f"strategy_specialist branch count {strategy_count} is below the minimum {min_count}")
            elif strategy_count > max_count:
                report.warnings.append(f"strategy_specialist branch count {strategy_count} exceeds recommended max {max_count}")
    if report.missing_nodes:
        report.fail("missing mandatory nodes: " + ", ".join(report.missing_nodes))

    execution_order = [normalize_node_id(item) for item in (record.get("execution_order") or raw_executed)]
    order_index = order_index_map(execution_order)
    for node in required_nodes:
        if node not in manifest["nodes"] or node == "decision":
            continue
        if node not in order_index:
            continue
        for dep in manifest["nodes"][node].get("dependencies", []):
            if dep not in order_index:
                report.dependency_violations.append(f"{node} missing dependency {dep}")
            elif order_index[dep] > order_index[node]:
                report.dependency_violations.append(f"{node} executed before dependency {dep}")
    if report.dependency_violations:
        report.fail("dependency violations: " + "; ".join(report.dependency_violations))

    runtime = record.get("runtime") or {}
    supports_independent_dispatch = bool(
        runtime.get("supports_independent_task_execution")
        and runtime.get("supports_structured_artifact_return")
    )
    dispatch_policy = manifest["modes"][mode]["dispatch_policy"]
    dispatched_raw = record.get("dispatched_nodes") or []
    dispatched = set(normalize_node_list(dispatched_raw))
    if supports_independent_dispatch and dispatch_policy == "required_when_available":
        for node in required_nodes:
            if node == "decision":
                continue
            if node == "strategy_specialist":
                strategy_dispatch_count = node_count(dispatched_raw, "strategy_specialist")
                strategy_count = int(record.get("strategy_branch_count") or node_count(raw_executed, "strategy_specialist"))
                if strategy_dispatch_count < strategy_count:
                    report.missing_dispatch.append(f"strategy_specialist({strategy_dispatch_count}/{strategy_count})")
                continue
            if node not in dispatched:
                report.missing_dispatch.append(node)
        if report.missing_dispatch:
            report.fail("mandatory nodes were not independently dispatched: " + ", ".join(report.missing_dispatch))
    elif not supports_independent_dispatch and dispatch_policy == "required_when_available":
        ensure_required_deviation(report, "WORKFLOW_DEVIATION: no_subagent_dispatch", deviation_set)

    if not record.get("evidence_audit_completed"):
        report.fail("evidence_audit_completed is false")
        ensure_required_deviation(report, "WORKFLOW_DEVIATION: evidence_audit_missing", deviation_set)

    if record.get("decision_owner") != manifest["controller"]["decision_owner"]:
        report.fail("decision_owner must remain controller")

    validate_order(report, manifest, record)

    dashboard = record.get("decision_dashboard")
    if dashboard is None:
        report.fail("decision_dashboard payload is missing")
        ensure_required_deviation(report, "WORKFLOW_DEVIATION: decision_dashboard_missing", deviation_set)
    else:
        schema_errors = validate_against_schema(dashboard, schema)
        if schema_errors:
            report.dashboard_schema_errors.extend(schema_errors)
            report.fail("decision_dashboard does not satisfy the schema")
            ensure_required_deviation(report, "WORKFLOW_DEVIATION: decision_dashboard_missing", deviation_set)

    if report.deliverable_violations:
        ensure_required_deviation(report, "WORKFLOW_DEVIATION: report_schema_incomplete", deviation_set)
    if report.missing_nodes or report.dependency_violations:
        ensure_required_deviation(report, "WORKFLOW_DEVIATION: mandatory_node_skipped", deviation_set)
    if report.missing_role_prompts:
        ensure_required_deviation(report, "WORKFLOW_DEVIATION: role_prompt_not_read", deviation_set)
    if report.missing_dispatch:
        ensure_required_deviation(report, "WORKFLOW_DEVIATION: no_subagent_dispatch", deviation_set)

    if report.compliant and deviation_set:
        report.warnings.append("workflow_deviations were declared even though the record is otherwise compliant")

    return report


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate invest-analysis-pro workflow execution against the machine-readable manifest and the Decision Dashboard schema."
    )
    parser.add_argument("--input", type=Path, help="Path to a workflow run record JSON file")
    parser.add_argument("--stdin", action="store_true", help="Read the workflow run record JSON from stdin")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST, help="Path to workflow-manifest.json")
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA, help="Path to decision-dashboard.schema.json")
    parser.add_argument("--print-example", action="store_true", help="Print the bundled example run record and exit")
    parser.add_argument("--strict", action="store_true", help="Exit with code 1 when the workflow record is non-compliant")
    parser.add_argument("--compact", action="store_true", help="Emit compact JSON instead of pretty JSON")
    args = parser.parse_args(argv)
    if not args.print_example and not args.stdin and args.input is None:
        parser.error("one of --input, --stdin, or --print-example is required")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.print_example:
        sys.stdout.write(DEFAULT_EXAMPLE.read_text(encoding="utf-8"))
        return 0

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    schema = json.loads(args.schema.read_text(encoding="utf-8"))
    record = load_json(args.input, from_stdin=args.stdin)
    report = validate_record(record, manifest, schema)
    payload = {
        "compliant": report.compliant,
        "mode": report.mode,
        "manifest_version": report.manifest_version,
        "missing_reads": report.missing_reads,
        "missing_role_prompts": report.missing_role_prompts,
        "missing_nodes": report.missing_nodes,
        "dependency_violations": report.dependency_violations,
        "missing_dispatch": report.missing_dispatch,
        "deliverable_violations": report.deliverable_violations,
        "dashboard_schema_errors": report.dashboard_schema_errors,
        "required_workflow_deviations": report.required_workflow_deviations,
        "warnings": report.warnings,
        "errors": report.errors,
    }
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":") if args.compact else None, indent=None if args.compact else 2)
    print(text)
    if args.strict and not report.compliant:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
