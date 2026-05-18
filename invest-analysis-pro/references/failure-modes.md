# Workflow Failure Modes and Anti-Patterns

Use this file as a negative checklist. These patterns come from real execution failures and must be treated as anti-patterns.

## Anti-Pattern 1: Controller-Only Narrative Instead of DAG Execution

**What goes wrong**
- The controller reads the evidence bundle and then writes a single blended analysis without dispatching the required role tasks.

**Why it is wrong**
- It bypasses the skill's main design goal: separable, reviewable, disagreement-aware branch opinions.

**Correct behavior**
- Follow `references/workflow-manifest.json`.
- Dispatch the mandatory role tasks whenever the runtime supports independent task execution.
- Keep Decision Synthesis in the controller.

## Anti-Pattern 2: Reading Strategy YAML Inline Without Running Strategy Specialist

**What goes wrong**
- The controller reads `strategies/*.yaml` and treats that as sufficient strategy coverage.

**Why it is wrong**
- Strategy evaluation is a branch opinion, not a controller-side annotation.

**Correct behavior**
- Run 1-3 Strategy Specialist branches in `specialist` mode.
- Pass the original YAML through `assets/subtask-payload-template.md`.

## Anti-Pattern 3: Skipping Role Prompts

**What goes wrong**
- The controller paraphrases what a role would probably say without reading the role prompt.

**Why it is wrong**
- The role contract, output schema, and scope guardrails live in the role prompts.

**Correct behavior**
- Read each role prompt before dispatch or simulation.
- Record prompt reads in the workflow run record.

## Anti-Pattern 4: Writing a Generic Narrative Instead of the Standard Deliverables

**What goes wrong**
- The final answer is a good natural-language analysis but lacks the primary report, Decision Dashboard JSON, or Evidence Audit Appendix.

**Why it is wrong**
- The skill requires stable artifacts for review, comparison, and downstream consumption.

**Correct behavior**
- Render the report from the bundled assets.
- Validate the Decision Dashboard JSON against `assets/decision-dashboard.schema.json`.
- Append the Evidence Audit Appendix.

## Anti-Pattern 5: Using Sequential Fallback Even Though Independent Dispatch Exists

**What goes wrong**
- The controller chooses the low-friction path and simulates all roles sequentially, even though the runtime can dispatch role tasks independently.

**Why it is wrong**
- It removes the intended branch separation and weakens workflow compliance.

**Correct behavior**
- When the runtime supports independent task execution, dispatch mandatory `standard`, `full`, and `specialist` nodes independently.
- If the runtime truly cannot do so, use sequential fallback and emit `WORKFLOW_DEVIATION: no_subagent_dispatch`.

## Anti-Pattern 6: Risk Collapsed Into the Final Conclusion

**What goes wrong**
- Risks are mentioned in the conclusion, but there is no explicit Risk Officer branch.

**Why it is wrong**
- The controller loses the dependency-gated risk reasoning layer and cannot show how risk modified the conclusion.

**Correct behavior**
- Run Risk Officer after the first wave whenever the selected mode requires it.
- Feed prior opinions, envelope warnings, and partial states into the risk branch.

## Anti-Pattern 7: No Deterministic Compliance Gate

**What goes wrong**
- The controller assumes the workflow was followed but never verifies it.

**Why it is wrong**
- Soft self-checks are easy to skip, misread, or partially remember.

**Correct behavior**
- Produce a run record.
- Run `python scripts/check_workflow_compliance.py --input <run-record.json> --strict`.
- Treat non-compliance as a workflow failure.
