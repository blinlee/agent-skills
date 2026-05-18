# Workflow Compliance Protocol

This protocol describes the deterministic verifier used for **strict acceptance, runtime conformance checks, and regression debugging**. It is not required reading for every routine stock analysis run.

## Command

```bash
python scripts/check_workflow_compliance.py --input <run-record.json> --strict
```

Options:

- `--print-example`: print the bundled example run record
- `--stdin`: read the run record from stdin
- `--manifest <path>`: override `references/workflow-manifest.json`
- `--schema <path>`: override `assets/decision-dashboard.schema.json`
- `--compact`: emit single-line JSON
- `--strict`: exit non-zero when the record is non-compliant

## Run Record Shape

Use `assets/workflow-run-record.example.json` as the shape reference.

The minimum fields are:

- `mode`
- `runtime.supports_independent_task_execution`
- `runtime.supports_structured_artifact_return`
- `required_reads`
- `role_prompts_read`
- `executed_nodes`
- `dispatched_nodes`
- `execution_order`
- `evidence_audit_completed`
- `decision_owner`
- `output_variant`
- `deliverable_order`
- `workflow_deviations`
- `portfolio_context`
- `strategy_branch_count` when strategy branches exist
- `decision_dashboard`

## What The Script Validates

1. required controller reads from `references/workflow-manifest.json`
2. required role-prompt reads
3. mandatory node execution by mode
4. dependency order from the workflow manifest
5. mandatory dispatch when the runtime supports independent task execution and structured artifact return
6. final deliverable order
7. Decision Dashboard JSON against `assets/decision-dashboard.schema.json`
8. required `WORKFLOW_DEVIATION` lines when compliance shortfalls exist

## Output

The script returns machine-readable JSON:

```json
{
  "compliant": true,
  "mode": "specialist",
  "manifest_version": 2,
  "missing_reads": [],
  "missing_role_prompts": [],
  "missing_nodes": [],
  "dependency_violations": [],
  "missing_dispatch": [],
  "deliverable_violations": [],
  "dashboard_schema_errors": [],
  "required_workflow_deviations": [],
  "warnings": [],
  "errors": []
}
```
