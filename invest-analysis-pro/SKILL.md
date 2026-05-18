---
name: invest-analysis-pro
description: invest-analysis-pro is an agent-native investment research skill. Use this skill whenever the user asks to analyze a stock, research a company or ticker, review market conditions, inspect news or intelligence, examine capital flow or leaderboard activity, interpret strategy YAML files, explain backtest results, or review portfolio or risk exposure. Default rule: if the user gives a stock and asks to analyze or research it, run the full specialist workflow unless the user explicitly asks for a faster or lighter mode. This skill gathers structured evidence, organizes research tasks as a DAG, and requires the controller agent to produce the final report; do not ask the user to run internal commands manually.
---

# invest-analysis-pro

## When to Use

Use this skill whenever the user asks for single-stock research, market review, news or intelligence gathering, technical evidence, fundamental evidence, capital flow, sector or leaderboard signals, portfolio risk review, backtest interpretation, or strategy YAML guidance.

Default rule: **if the user provides a stock and asks to "look at", "analyze", or "research" it, run the most detailed `specialist` workflow by default**. `quick`, `standard`, and `full` are not default paths; only use them when the user explicitly asks for a lighter mode.

## Mandatory Workflow

1. Identify the stock, market, research scope, and whether the user explicitly requested a lower mode.
2. Read `references/evidence-contract.md`, then let the agent call the internal deterministic data adapters to obtain JSON evidence; do not tell the user to type internal commands manually.
3. Read the envelope fields: `status`, `coverage`, `source_chain`, `errors`, and `warnings`.
4. If `status=failed`, do not invent conclusions; explain the failure and either narrow the task or request additional input.
5. If `status=partial`, you may continue, but you must disclose the missing modules, failure reasons, and confidence impact.
6. For `full` or `specialist`, organize the research tasks using `references/dag-workflow.md`; the final decision and final report must be completed by the current controller agent, not delegated as an independent research task.
7. Produce the final report using `references/report-standard.md`.

## Mode Selection

| Mode | Trigger | Research DAG | Evidence guidance |
| --- | --- | --- | --- |
| `quick` | Only when the user explicitly asks for a quick, brief, rough, or lightweight view | Technical -> Controller Decision | quote, technical, ma, volume, with limited large fields |
| `standard` | Only when the user explicitly asks for the standard tier | Technical + Intel -> Controller Decision | quote, history, technical, ma, volume, pattern, plus news/intel when needed |
| `full` | Only when the user explicitly asks for a full run but does not want strategy specialists | Technical + Intel + Fundamentals & Flow -> Risk -> Controller Decision | full evidence: technicals, fundamentals, capital flow, sector, leaderboard, news/intel |
| `specialist` | **Default:** the user provides a stock and asks for analysis or research; or explicitly asks for the most detailed, expert, or strategy-aware view | full + Strategy Specialist(s) -> Controller Decision | full evidence + `strategies/*.yaml`; if no strategy is specified, select up to 3 strategies based on the market state |

## Default Specialist Workflow

1. Gather a full evidence bundle: quote, history, technicals, moving averages, volume and price, patterns, fundamentals, capital flow, sector, and leaderboard data; add news or intelligence when needed.
2. Enumerate and read the relevant `strategies/*.yaml` files. If the user did not specify a strategy, first infer the market state from the Technical result, then select up to 3 Strategy Specialists. If the state is unclear, use the default router strategies `bull_trend` and `shrink_pullback`.
3. Perform an Evidence Audit: confirm which data is available, which modules are partial or failed, and which sources are usable for final conclusions.
4. Dispatch the research subtasks according to the DAG.
5. The controller agent synthesizes all opinions and writes the standard report.

## Capability Fallback

Choose the highest available path for the current agent environment:

1. **Local evidence mode**: if the agent can execute local commands, prefer calling the internal data adapters to obtain JSON evidence.
2. **Provided evidence mode**: if the agent cannot execute local commands but the user or an external system has already provided structured market, news, financial, or capital-flow evidence, continue the DAG using that evidence and explicitly disclose source quality and gaps.
3. **No evidence mode**: if the agent can neither execute local commands nor access usable evidence, do not fake analysis; explain which evidence is required to complete the research.

## DAG Task Semantics

If the current runtime supports parallel or independent research tasks, `standard`, `full`, and `specialist` should run all parallelizable branches in parallel according to the DAG. If the runtime does not support parallel tasks, complete the same DAG sequentially in the current session without skipping analysis.

Dispatch rules:

1. **Split researcher tasks, not Decision**: Technical, Intel, Fundamentals & Flow, Risk, Strategy, and Portfolio may run as independent research tasks. Final Decision Synthesis and final report writing must stay with the controller agent.
2. **`quick`**: run only the Technical Analyst, then let the controller synthesize the result.
3. **`standard` first wave**: after the Evidence Audit, Technical Analyst and Intel Analyst may run in parallel.
4. **`full` first wave**: after the Evidence Audit, Technical Analyst, Intel Analyst, and Fundamentals & Flow Analyst may run in parallel.
5. **Risk Officer is dependency-gated**: it must wait for Technical, Intel, and Fundamentals & Flow outputs.
6. **Specialist strategy branches are dependency-gated**: a Strategy Specialist must receive the corresponding strategy YAML and the Technical output. A Portfolio Analyst only runs for portfolio or holdings tasks, and it must receive portfolio/risk evidence plus the single-stock base opinions.
7. **Controller waits, then synthesizes**: the controller agent reads all subtask outputs and the evidence `coverage`, `source_chain`, `errors`, and `warnings`, then produces the final report using `references/report-standard.md`.

## Subtask Payload Template

Use the following structure whenever you dispatch or simulate research subtasks, so that each task only handles its own responsibility:

```text
Role: <Technical Analyst | Intel Analyst | Fundamentals & Flow Analyst | Risk Officer | Strategy Specialist | Portfolio Analyst>
Prompt: references/prompts/<role>.md
Stock: <code + name + market if known>
Mode: <quick | standard | full | specialist>
Evidence slices: <only the compact JSON evidence relevant to that role; describe missing modules when necessary>
Prior opinions: <none | Technical output | Intel output | Fundamentals & Flow output | Strategy output>
Strategy YAML: <required only for Strategy Specialist; paste the corresponding strategies/*.yaml content>
Tool policy: do not call external tools or data adapters unless the controller explicitly authorizes it
Output language: Chinese unless the user requested another language
Required output: JSON only, no markdown fence, follow the prompt contract, no final investment recommendation
Missing-data policy: mark unknown/missing_data and lower confidence; do not invent facts
```

## Routing Guide

| User intent | Preferred path |
| --- | --- |
| User provides a stock and asks for analysis or research (default) | `specialist`: full evidence + strategy framework + research DAG |
| User explicitly asks for a quick stock check | `quick`: minimal evidence + Technical |
| User explicitly asks for the standard tier | `standard`: Technical + Intel |
| User explicitly asks for `full` but does not want strategy specialists | `full`: Technical + Intel + Fundamentals & Flow + Risk |
| News, event, or intelligence task | news/intel evidence + Intel Analyst |
| Market or sector review | market/sector evidence + controller-led market review |
| Strategy reference | `strategies/*.yaml` + Strategy Specialist |
| Backtest interpretation | backtest evidence + Technical/Strategy |
| Portfolio risk review | portfolio/risk evidence + Portfolio Analyst |
| Save research output | Only if the environment provides a save interface and the user wants archiving; the controller saves the completed report |

## Gotchas

- The human entry point is a natural-language request, not a manual CLI tutorial; do not ask the user to run commands manually.
- The internal data adapters only produce evidence. They do not call an LLM and do not produce a natural-language report or investment conclusion. Research subtasks only produce branch opinions. The controller agent produces the final conclusion, risk disclosure, and non-personalized decision framework.
- Do not require any OpenAI, Gemini, Anthropic, DeepSeek, or LiteLLM key.
- If REST APIs, dashboards, notifications, schedulers, or desktop surfaces exist, treat them as optional delivery or review layers; do not start services or call save interfaces by default.
- Do not ignore the envelope. `coverage`, `source_chain`, `errors`, and `warnings` are part of evidence quality.
- Data sources may return `partial` or `failed`; never invent missing data.
- Large outputs must use `compact`, `full`, `limit`, or an equivalent mechanism to avoid context explosion.
- Do not trigger broad live-network scraping just to fill gaps; prefer small-scope retrieval, cached data, or existing evidence.
- Public product language, the skill name, and report titles must consistently use `invest-analysis-pro`.

## Internal References

- Evidence adapter contract: `references/evidence-contract.md`
- Research DAG: `references/dag-workflow.md`
- Role prompts: `references/prompts/*.md`
- Standard report: `references/report-standard.md`
- Strategy framework: `strategies/*.yaml`
