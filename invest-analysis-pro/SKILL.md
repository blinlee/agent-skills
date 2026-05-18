---
name: invest-analysis-pro
description: invest-analysis-pro is an agent-native investment research skill. Use this skill whenever the user asks to analyze a stock, research a company or ticker, review market conditions, inspect news or intelligence, examine capital flow or leaderboard activity, interpret strategy YAML files, explain backtest results, or review portfolio or risk exposure. Default rule: if the user gives a stock and asks to analyze or research it, run the full specialist workflow unless the user explicitly asks for a faster or lighter mode. This skill gathers structured evidence, organizes research tasks as a DAG, and requires the controller agent to produce the final report; do not ask the user to run internal commands manually.
---

# invest-analysis-pro

## When to Use

Use this skill whenever the user asks for single-stock research, market review, news or intelligence gathering, technical evidence, fundamental evidence, capital flow, sector or leaderboard signals, portfolio risk review, backtest interpretation, or strategy YAML guidance.

Default rule: **if the user provides a stock and asks to analyze or research it, run the `specialist` workflow by default**. `quick`, `standard`, and `full` are opt-down modes and should be used only when the user explicitly asks for a lighter tier.

## Non-Negotiable Rules

- Do not collapse into a controller-only narrative after reading evidence.
- Do not produce the final answer before the required artifact package is complete.
- If mandatory dispatch is available, dispatch the mandatory role tasks. If no dedicated callable subagent exists for a required role, use a same-agent/self-spawn worker instead of falling back to inline controller reasoning.

## Required Core Assets

Read these assets before synthesis:

1. `references/evidence-contract.md`
2. `references/dag-workflow.md`
3. `references/report-standard.md`
4. `references/workflow-manifest.json`

Before dispatching any role task, read that role's prompt file from `references/prompts/`.

Use these supporting assets when you need strict acceptance, runtime alignment, or workflow debugging:

- `references/controller-checklist.md`
- `references/compliance-protocol.md`
- `references/failure-modes.md`

## Mode Selection

Use the mode rules from `references/workflow-manifest.json`.

| Mode | Use when | Primary shape |
| --- | --- | --- |
| `quick` | The user explicitly asks for a quick, rough, or lightweight pass | Evidence Audit -> Technical -> Controller Decision |
| `standard` | The user explicitly asks for the standard tier | Evidence Audit -> Technical + Intel -> Controller Decision |
| `full` | The user explicitly asks for a full run without strategy branches | Evidence Audit -> Technical + Intel + Fundamentals & Flow -> Risk -> Controller Decision |
| `specialist` | **Default** stock-research mode | Evidence Audit -> first-wave role tasks -> Risk -> 1-3 Strategy Specialists -> Controller Decision |

## Execution Contract

1. Identify the stock, market, research scope, and whether the user explicitly requested a lower mode.
2. Read the required core assets and use `references/workflow-manifest.json` as the machine-readable source of truth for mandatory nodes, dependencies, deliverables, and deviation codes.
3. Obtain structured JSON evidence via the internal deterministic data adapters, or explicitly switch to Provided evidence mode / No evidence mode.
4. Perform an explicit **Evidence Audit** over `status`, `coverage`, `source_chain`, `errors`, and `warnings` before any synthesis.
5. Follow the DAG and dispatch rules in `references/dag-workflow.md`.
6. If the runtime supports independent task execution and structured artifact return, dispatch all mandatory `standard`, `full`, and `specialist` role tasks independently. If the runtime also supports concurrent role workers, run the first wave in parallel. In multi-agent host runtimes such as OpenClaw-style environments, a runtime config may restrict the callable subagent list; if no callable specialist is available for a required role, spawn the same agent type/model as the current session and keep the role contract unchanged.
7. Use `assets/subtask-payload-template.md` for every dispatched or simulated role task.
8. Decision Synthesis and final report writing **must remain in the controller session** and must not be delegated as an independent role task.
9. Do not produce any user-facing final analysis before the required artifact package has been prepared. For `specialist`, this means the mandatory role nodes must be completed, Decision Dashboard JSON must exist, Evidence Audit Appendix must exist, and the final report must be rendered from the bundled template assets.
10. Render deliverables with `assets/final-report-template.md`, `assets/brief-report-template.md`, `assets/short-message-template.md`, `assets/evidence-audit-template.md`, and `assets/decision-dashboard.schema.json`.
11. When you are validating a new runtime, doing strict acceptance, or debugging workflow drift, run the deterministic compliance gate described in `references/compliance-protocol.md`.

## Capability Fallback

Choose the highest available path for the current environment:

1. **Local evidence mode**: execute the internal data adapters to retrieve JSON evidence.
2. **Provided evidence mode**: continue the DAG using user-provided or externally supplied structured evidence.
3. **No evidence mode**: do not invent market, news, financial, or flow data; explain what evidence is required.

## Before Final Output

Controller must verify all of the following before answering the user:

- mandatory nodes executed
- mandatory dispatch completed, or formal workflow deviation recorded
- separate role outputs exist as distinct role artifacts rather than only as absorbed controller reasoning
- Decision Dashboard JSON prepared
- Evidence Audit Appendix prepared
- final report rendered from the bundled template assets

If any item is false, do not output the final analysis yet.

## Artifact Assembly Order

Assemble the required artifacts in this order:

1. role outputs
2. Evidence Audit Appendix
3. Decision Dashboard JSON
4. final markdown report rendered from bundled template assets
5. optional short-message rendering

The final prose should be rendered **from** the assembled artifacts rather than written freehand first and backfilled later.

## Gotchas

- The human entry point is a natural-language research request, not a manual CLI tutorial; do not ask the user to run commands manually.
- The internal data adapters only produce evidence. They do not call an LLM and do not produce the final research conclusion.
- Do not collapse back into a controller-only narrative after reading evidence.
- Do not claim that a role "ran" unless it produced a separate role artifact.
- Reading a strategy YAML file inline is **not** a substitute for a Strategy Specialist branch in `specialist` mode.
- Do not treat an empty callable-subagent list as “cannot dispatch”; if independent task execution exists, use same-agent/self-spawn workers.
- Do not return a natural-language final answer before the required artifact package exists.
- `Decision Dashboard JSON` and the `Evidence Audit Appendix` are mandatory artifacts even in `quick` and `standard` when the run is otherwise compliant.
- If a mandatory node, prompt read, dispatch step, or deliverable is missing, the controller must treat the run as non-compliant and use the workflow deviation codes when a formal compliance check is being recorded.
- Large evidence payloads must use `compact`, `full`, `limit`, or an equivalent truncation guard.
- Use `references/failure-modes.md` as an anti-pattern reference when a runtime repeatedly drifts from the workflow.
- Public product language, the skill name, and report titles must consistently use `invest-analysis-pro`.

## Internal References

- Evidence adapter contract: `references/evidence-contract.md`
- Research DAG: `references/dag-workflow.md`
- Machine-readable workflow rules: `references/workflow-manifest.json`
- Role prompts: `references/prompts/*.md`
- Report and output contract: `references/report-standard.md`
- Strategy framework: `strategies/*.yaml`
- Output assets: `assets/*.md`, `assets/*.json`
- Strict acceptance and debugging references: `references/controller-checklist.md`, `references/compliance-protocol.md`, `references/failure-modes.md`
