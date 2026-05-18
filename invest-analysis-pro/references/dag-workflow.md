# invest-analysis-pro DAG Workflow

This document defines how `invest-analysis-pro` should orchestrate research **after** the JSON evidence bundle has been collected. The internal data adapter layer is only responsible for data retrieval, deterministic calculations, caching, fallback handling, and JSON-envelope output. Research judgment, subtask dispatching, disagreement handling, and final report writing are owned by the controller agent.

## Four Research Modes

| Mode | Trigger | DAG |
| --- | --- | --- |
| `quick` | The user explicitly asks for a quick, brief, rough, or lightweight view | Evidence Audit -> Technical Analyst -> Controller Decision |
| `standard` | The user explicitly asks for the standard tier | Evidence Audit -> Technical Analyst + Intel Analyst -> Controller Decision |
| `full` | The user explicitly asks for a full run but does not want strategy specialists | Evidence Audit -> Technical + Intel + Fundamentals & Flow -> Risk Officer -> Controller Decision |
| `specialist` | **Default:** the user provides a stock and asks for analysis or research; or explicitly asks for the most detailed, expert, or strategy-aware view | full -> Strategy Specialist(s) -> Controller Decision; portfolio/holdings tasks may additionally use Portfolio Analyst |

## Default DAG (`specialist`)

```text
0. Evidence Bundle
   The controller session obtains the full JSON envelope

        ↓

1. Evidence Audit (controller session)
   Check status / coverage / source_chain / errors / warnings
   Decide which branches are executable

        ↓

2. First-layer parallel research
   ├─ Technical Analyst
   ├─ Intel Analyst
   ├─ Fundamentals & Flow Analyst
   └─ Backtest Analyst (only when requested or already present in evidence)

        ↓

3. Second-layer dependency-gated research
   ├─ Risk Officer
   │   Depends on Technical + Intel + Fundamentals & Flow
   │
   ├─ Strategy Specialist(s)
   │   Depends on Technical; some strategies also depend on Fundamentals & Flow
   │
   └─ Portfolio Analyst (portfolio tasks)
       Depends on single-stock base opinions / holdings evidence

        ↓

4. Decision Synthesis (completed by the controller session; never dispatched as an independent research task)
   The controller session synthesizes all sub-opinions and generates the standard outputs using
   `references/report-standard.md`.
```

Default strategy selection rules inside `specialist`:
- First use user-specified strategies when provided.
- Otherwise infer the market state from the Technical result and select up to 3 strategies.
- If the market state cannot be inferred confidently, use the default router strategies `bull_trend` and `shrink_pullback`.

## Why It Is Not Fully Sequential

The internal data adapter layer produces a shared evidence bundle first. Multiple researchers can read the same source of facts, so the first research wave can usually run in parallel: Technical, Intel, and Fundamentals & Flow do not normally have hard dependencies on one another. Parallelism reduces waiting time and avoids one research role anchoring the narrative too early for other roles.

## Why It Is Not Fully Parallel

Some nodes depend on prior opinions:

| Node | Dependencies | Why |
| --- | --- | --- |
| Risk Officer | Technical / Intel / Fundamentals & Flow | Risk screening must jointly consider breakdown risk, negative events, capital flow, valuation, and data-quality gaps. |
| Strategy Specialist | Technical, sometimes Fundamentals & Flow | Strategy YAML rules usually require trend confirmation, key levels, volume-price structure, and strategy conditions first. |
| Portfolio Analyst | Single-stock base opinions / holdings evidence | Portfolio risk requires single-stock signals, confidence levels, and position structure. |
| Decision Synthesis | All prior outputs | The final conclusion must integrate all evidence, disagreements, and risks. |

## Subtask Dispatch Template

Use the following payload whenever the controller agent dispatches or simulates a research subtask. Do not let a research task re-plan the entire workflow, and do not let a research task produce the final investment conclusion.

```text
Role: <Technical Analyst | Intel Analyst | Fundamentals & Flow Analyst | Risk Officer | Strategy Specialist | Portfolio Analyst>
Prompt: references/prompts/<role>.md
Stock: <code + name + market if known>
Mode: <quick | standard | full | specialist>
Objective: <the specific question this role must answer in this round>
Evidence slices:
  - envelope.status: <ok|partial|failed>
  - coverage summary: <requested/succeeded/failed>
  - relevant data: <compact JSON or key-field excerpt>
  - errors/warnings relevant to this role: <list>
Prior opinions: <none | Technical output | Intel output | Fundamentals & Flow output | Risk output>
Strategy YAML: <required only for Strategy Specialist; paste the corresponding strategies/*.yaml content>
Tool policy: do not call external tools or data adapters unless the controller explicitly authorizes it
Output language: Chinese unless the user requested another language
Output contract: JSON only; no markdown fence; follow the prompt schema; no final report; no final buy/hold/sell decision unless the prompt explicitly asks for a local signal classification.
Missing-data policy: mark unknown/missing_data, lower confidence, and state what evidence is required to resolve it.
```

## Controller Responsibilities

The controller session acts as the investment committee chair and final report author:

1. Call the internal data adapter layer and retain the evidence envelope.
2. Perform the Evidence Audit and disclose all `partial`, `failed`, and warning states.
3. Dispatch all first-wave parallel subtasks according to the DAG.
4. Wait for dependencies before dispatching Risk / Strategy / Portfolio.
5. Never dispatch Decision as an independent research task; synthesize it locally using `references/prompts/decision-synthesis.md` and `references/report-standard.md`.
6. If the environment exposes a result-save interface and the user wants archival, save the finished report only after the research is complete; the save step must not trigger a new analysis pipeline.

## Recommended Prompt Assets

- Technical: `references/prompts/technical-analyst.md`
- Intel: `references/prompts/intel-analyst.md`
- Fundamentals & Flow: `references/prompts/fundamentals-flow-analyst.md`
- Risk: `references/prompts/risk-officer.md`
- Strategy: `references/prompts/strategy-specialist.md`
- Portfolio: `references/prompts/portfolio-analyst.md`
- Decision / controller synthesis: `references/prompts/decision-synthesis.md`
- Standard report: `references/report-standard.md`
