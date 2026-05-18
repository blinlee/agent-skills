# invest-analysis-pro Standard Report Flow and Deliverables

This document defines the standard outputs for `invest-analysis-pro` **after** the controller agent has received the evidence bundle and the role opinions. Decision Synthesis is always completed by the controller session and is never dispatched as an independent task.

`references/workflow-manifest.json` is the machine-readable source of truth for deliverable order and required artifacts. This document focuses on how to render those artifacts cleanly during normal execution.

## Standard Flow

1. **Evidence Audit**
   - Record the envelope `status`.
   - Summarize `coverage.requested / succeeded / failed`.
   - Extract the important entries from `source_chain`.
   - Disclose `errors` / `warnings` that materially affect the conclusion.

2. **Role Opinion Review**
   - Summarize Technical / Intel / Fundamentals & Flow / Risk / Strategy / Portfolio outputs.
   - Mark disagreements, e.g. technicals bullish while capital flow is negative.
   - Downgrade confidence when key evidence or key branches are `partial` / `failed`.

3. **Decision Synthesis**
   - Use `references/prompts/decision-synthesis.md`.
   - Keep `decision_type` inside `buy|hold|sell`.
   - Express stronger or weaker conviction through `sentiment_score`, `confidence_level`, natural-language explanation, and risk signaling.

4. **Deliverable Rendering**
   - Render the primary report from one of the bundled report templates.
   - Emit the Decision Dashboard JSON.
   - Append the Evidence Audit Appendix.
   - Use workflow deviation codes only when a formal compliance check or a material workflow shortfall needs to be disclosed.

## Artifact Assembly Order

Build the final package in this order:

1. Role-output artifacts
2. Evidence Audit Appendix
3. Decision Dashboard JSON
4. Primary report rendered from a bundled report template
5. Optional short-message rendering

The controller should assemble artifacts first and render the final prose from those artifacts. Do not write a freehand final narrative first and backfill the package afterward.

## Deliverable Order

Use this order:

1. `WORKFLOW_DEVIATION` lines when applicable
2. Primary report (`full_markdown_report` or `brief_summary_report` depending on the mode and request)
3. Decision Dashboard JSON
4. Evidence Audit Appendix

Rules:

- `specialist` and `full` default to `full_markdown_report`.
- `quick` and `standard` may use `brief_summary_report` only when the user explicitly asked for a brief/lightweight output.
- `decision_dashboard_json` and `evidence_audit_appendix` are mandatory for every compliant mode.
- `short_message_report` is an additional rendering surface, not a replacement for the mandatory package.

## Output Assets

Use these files directly instead of reconstructing the schema from prose:

- Full report template: `assets/final-report-template.md`
- Brief report template: `assets/brief-report-template.md`
- Short-message template: `assets/short-message-template.md`
- Evidence Audit Appendix template: `assets/evidence-audit-template.md`
- Decision Dashboard schema: `assets/decision-dashboard.schema.json`

## Template Field Mapping

Fields absorbed from the report templates should be filled from these sources. If a field is unavailable, write `N/A`, `unknown`, or disclose the gap explicitly; never invent content.

| Report field | Preferred source | Missing-data handling |
| --- | --- | --- |
| `{report_date}` / `{generated_at}` | evidence-envelope `generated_at` or current session time | mark generation time as unconfirmed |
| `{buy_count}` / `{hold_count}` / `{sell_count}` | count of each ticker's `decision_type` | even a single-ticker report still computes 1/0 counts |
| `{signal_emoji}` / `{signal_text}` | `decision_type` + `sentiment_score` + `confidence_level` | use ⚠️ and explain the low-confidence reason |
| `{one_sentence}` | `dashboard.core_conclusion.one_sentence`, otherwise `analysis_summary` | controller summarizes and marks low confidence |
| Market snapshot | quote / market-snapshot evidence | omit the whole section if missing and disclose the gap |

## Strict Acceptance Note

`references/compliance-protocol.md` and `scripts/check_workflow_compliance.py` are strict-acceptance tools. They help evaluate runtime conformance and regression behavior, but they are not separate user-facing report sections.
