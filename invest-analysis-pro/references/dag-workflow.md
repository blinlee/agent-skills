# invest-analysis-pro DAG Workflow

This document defines how `invest-analysis-pro` orchestrates research **after** the JSON evidence bundle has been collected. The internal data adapter layer is responsible only for retrieval, deterministic calculations, caching, fallback handling, and JSON-envelope output. Research judgment, subtask dispatching, disagreement handling, and final report writing belong to the controller agent.

`references/workflow-manifest.json` is the machine-readable source of truth for mode-specific mandatory nodes, dependencies, deliverables, and workflow deviation codes. This document explains how to apply that manifest during normal execution.

## Execution Strength

For this skill, the DAG is not advisory.

- If the runtime supports **independent task execution** and **structured artifact return**, the controller **must** dispatch the mandatory role tasks for `standard`, `full`, and `specialist` independently.
- If the runtime also supports **concurrent role workers**, run the first wave in parallel.
- In multi-agent host runtimes that expose a config-controlled callable-agent list, use that configured list first when selecting role workers.
- If the runtime can dispatch role tasks but no dedicated callable subagent exists for a mandatory role, dispatch a same-agent/self-spawn worker and keep the role prompt, payload, and deliverable contract unchanged.
- If independent task execution is unavailable, sequential controller fallback is allowed.
- The controller must read each role prompt before dispatching that role.
- The controller must use `assets/subtask-payload-template.md` for every dispatched or simulated role task.
- The compliance protocol is primarily for strict acceptance and runtime debugging; routine execution should stay focused on evidence, role opinions, and final synthesis.

## Mode Summary

| Mode | Trigger | Mandatory nodes | Report shape |
| --- | --- | --- | --- |
| `quick` | The user explicitly asks for a quick, rough, or lightweight view | Technical | Brief or full report + JSON + Evidence Audit Appendix |
| `standard` | The user explicitly asks for the standard tier | Technical + Intel | Brief or full report + JSON + Evidence Audit Appendix |
| `full` | The user explicitly asks for a full run without strategy specialists | Technical + Intel + Fundamentals & Flow + Risk | Full report + JSON + Evidence Audit Appendix |
| `specialist` | Default stock-research mode | Technical + Intel + Fundamentals & Flow + Risk + 1-3 Strategy Specialists | Full report + JSON + Evidence Audit Appendix |

## Default DAG (`specialist`)

```text
0. Evidence Bundle
   The controller session obtains the full JSON envelope.

1. Evidence Audit (controller)
   Check status / coverage / source_chain / errors / warnings.
   Decide which branches are executable.

2. First wave
   ├─ Technical Analyst
   ├─ Intel Analyst
   └─ Fundamentals & Flow Analyst
   Run in parallel when the runtime supports concurrent independent role workers.

3. Dependency-gated second wave
   ├─ Risk Officer (depends on Technical + Intel + Fundamentals & Flow)
   ├─ Strategy Specialist(s) (depend on Technical, sometimes Fundamentals & Flow)
   └─ Portfolio Analyst (only when portfolio context exists)

4. Decision Synthesis (controller only)
   The controller synthesizes all role outputs and renders the final deliverables.
```

## Why The DAG Is Mixed Parallel / Dependency-Gated

The first wave can usually run in parallel because those roles read the same evidence bundle and do not require one another's judgments. Risk, Strategy, and Portfolio are dependency-gated because they reason over the earlier role outputs rather than only over raw evidence.

| Node | Dependencies | Why |
| --- | --- | --- |
| Risk Officer | Technical / Intel / Fundamentals & Flow | Risk screening must reason over cross-signal conflicts, negative events, and data-quality gaps. |
| Strategy Specialist | Technical, sometimes Fundamentals & Flow | Strategy rules depend on trend confirmation, key levels, and sometimes company-quality context. |
| Portfolio Analyst | Single-stock opinions / holdings evidence | Portfolio risk depends on conviction, diversification, and exposure. |
| Decision Synthesis | All prior outputs | The final conclusion integrates evidence, disagreements, and risk disclosures. |

## Strategy Selection Rules

- Prefer user-specified strategies when they exist.
- Otherwise infer market regime from the Technical output and select up to 3 strategy branches.
- If the regime is still ambiguous, use the default router strategies `bull_trend` and `shrink_pullback`.
- Reading YAML inline is not a substitute for a Strategy Specialist branch in `specialist` mode.

## Worker Selection Rule

Apply this worker-selection order for every mandatory dispatched role task:

1. Use a dedicated callable specialist subagent when the host runtime exposes one for that role.
2. If no dedicated callable specialist is available but independent task execution still exists, dispatch a same-agent/self-spawn worker.
3. Only when independent task execution itself is unavailable may the controller use sequential fallback.

## Dispatch and Dependency Rules

Use the node list and dependency graph in `references/workflow-manifest.json`.

- `quick`: Technical is mandatory; controller-local execution is acceptable.
- `standard`: Technical and Intel are mandatory and must be independently dispatched when the runtime supports independent task execution and structured artifact return.
- `full`: Technical, Intel, Fundamentals & Flow, and Risk are mandatory; Risk must not start before the first wave completes.
- `specialist`: all `full` nodes plus 1-3 Strategy Specialist branches are mandatory; Portfolio becomes mandatory only when portfolio context exists.

## Reference Assets

- Role-task payload source of truth: `assets/subtask-payload-template.md`
- Deliverable source of truth: `references/report-standard.md`
- Strict acceptance / runtime-debug tools: `references/compliance-protocol.md`, `references/controller-checklist.md`, `references/failure-modes.md`
