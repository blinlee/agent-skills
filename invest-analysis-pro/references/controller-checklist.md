# Controller Compliance Checklist

This checklist is for **strict acceptance, runtime alignment, and workflow debugging**. It is not meant to make routine execution feel ceremonial. Use it when you are validating a new host runtime, checking regressions, or investigating workflow drift.

## Step 1: Confirm the Workflow Inputs

- [ ] `references/evidence-contract.md` was read
- [ ] `references/dag-workflow.md` was read
- [ ] `references/report-standard.md` was read
- [ ] `references/workflow-manifest.json` was read
- [ ] the required role prompts were read
- [ ] the correct mode (`quick` / `standard` / `full` / `specialist`) was selected
- [ ] Evidence Audit was completed explicitly

## Step 2: Confirm Mandatory Node Execution

- [ ] first-wave mandatory role tasks were executed
- [ ] Risk Officer executed when required by the selected mode
- [ ] Strategy Specialist branch(es) executed when required by the selected mode
- [ ] Portfolio Analyst executed when required by the task scope
- [ ] mandatory dispatch occurred when the runtime supported independent task execution and structured artifact return
- [ ] Decision stayed in the controller session

## Step 3: Confirm Mandatory Deliverables

- [ ] the primary report matches the requested mode / output shape
- [ ] Decision Dashboard JSON was generated
- [ ] Decision Dashboard JSON satisfies `assets/decision-dashboard.schema.json`
- [ ] Evidence Audit Appendix was prepared
- [ ] final deliverable order matches `references/workflow-manifest.json`

## Optional Deterministic Gate

When strict validation is needed, validate the run record:

```bash
python scripts/check_workflow_compliance.py --input <run-record.json> --strict
```

Use `assets/workflow-run-record.example.json` as the shape reference. The controller should treat a non-zero exit or a non-compliant JSON result as a workflow failure only when the run is being formally validated.
