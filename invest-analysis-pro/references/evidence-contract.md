# invest-analysis-pro Evidence Contract

`invest-analysis-pro` is an evidence-first investment research skill. The internal data adapter layer only handles data collection, deterministic computation, cache reuse, fallback handling, and structured JSON output. Final analysis, report writing, and investment judgment are completed by the calling controller agent.

## Capability Tiers

Choose the highest available path for the current agent environment:

1. **Local evidence mode**: if the agent can execute local commands, use the internal data adapter layer to obtain JSON evidence.
2. **Provided evidence mode**: if the agent cannot execute local commands, but the user or an external system has already provided structured market, news, financial, or capital-flow data, continue the research using that evidence and explicitly disclose source quality and gaps.
3. **No evidence mode**: if the agent can neither execute local commands nor access usable evidence, do not output fake analysis; explain which evidence is required to complete the research.

## Agent-Internal Entry Points

```bash
python main.py invest-analysis-pro --help
python main.py invest-analysis-pro <command> --help
```

These commands are executed by the agent inside the skill workflow in order to retrieve evidence. Do not ask the user to run them manually. If local commands are unavailable, fall back to Provided evidence mode or No evidence mode.

Compatible aliases: `python main.py agent ...`, `python main.py iap ...`. Documentation and user-visible product language must consistently use `invest-analysis-pro`.

## JSON Envelope

All non-help internal commands must return JSON in the same outer shape:

```json
{
  "status": "ok | partial | failed",
  "task": "bundle",
  "input": {},
  "data": {},
  "coverage": {},
  "source_chain": [],
  "errors": [],
  "warnings": [],
  "generated_at": "2026-05-16T00:00:00Z"
}
```

Field semantics:

- `ok`: requested modules completed and no structured error was detected.
- `partial`: at least one module failed or was missing, but usable evidence still exists.
- `failed`: parameter error, unknown tool, or total failure of the requested modules.
- `errors`: machine-readable failures such as external data-source errors, tool failures, or parameter errors.
- `warnings`: non-fatal states such as truncation, `not_supported`, insufficient cache, info/note messages, and similar conditions.
- `source_chain`: sources, caches, or fallback paths extracted from tool results.
- `coverage`: requested modules, succeeded/failed modules, output mode, and limit information.

The internal data adapter layer must never invent missing facts. The controller agent should disclose `partial` / `failed` states and key `errors` / `warnings` in its final answer.

## Output Size Control

All internal commands support:

- `--limit N`: recursively limit list lengths in compact mode; default `20`.
- `--full`: disable recursive truncation and keep the full structured payload.
- `--compact`: enabled by default for agent-context safety.

Use `--limit` especially on `history`, `news`, `intel`, `fundamentals`, and `bundle`.

## Internal Command Inventory

| Capability | Internal command | Reuse path |
| --- | --- | --- |
| Realtime quote | `quote <stock_code>` | `src.agent.tools.data_tools.get_realtime_quote_tool` -> `DataFetcherManager.get_realtime_quote` |
| Daily history | `history <stock_code> --days N` | `get_daily_history_tool` -> `src.services.history_loader` + DB cache |
| Technical indicators / trend | `technical <stock_code>` / `trend` | `src.agent.tools.analysis_tools.analyze_trend_tool` |
| Moving averages | `ma <stock_code> --periods 5,10,20` | `calculate_ma_tool` |
| Volume-price analysis | `volume <stock_code>` | `get_volume_analysis_tool` |
| Pattern analysis | `pattern <stock_code>` | `analyze_pattern_tool` |
| Local composite analysis | `local-analysis <stock_code>` | trend + MA + volume + pattern composition |
| Chip distribution | `chip <stock_code>` | `get_chip_distribution_tool` |
| Fundamentals / stock info | `fundamentals <stock_code>` / `stock-info` | `get_stock_info_tool` -> fundamental context |
| Main-force capital flow | `capital-flow <stock_code>` | `get_capital_flow_tool` |
| Boards / sectors | `boards <stock_code>` / `sector` | `get_board_context_tool` / `get_sector_rankings_tool` |
| Dragon-tiger leaderboard | `lhb <stock_code>` / `dragon-tiger` | `get_dragon_tiger_tool` -> fundamental adapter |
| Market data | `market --include indices,stats,sectors,hot` | `market_tools` + `DataFetcherManager` fallback |
| News | `news <stock_code> --stock-name <name>` | `search_stock_news_tool` |
| Intelligence | `intel <stock_code> --stock-name <name>` | `search_comprehensive_intel_tool` |
| Backtest | `backtest [--stock-code X|--strategy-id Y]` | `backtest_tools` + `BacktestService` read-only summaries |
| Portfolio / risk | `portfolio` / `risk` | `get_portfolio_snapshot_tool` + portfolio services |
| Strategy YAML | `strategies list/show` | `strategies/*.yaml` |
| One-shot context bundle | `bundle <stock_code> --include ...` | sequential multi-tool execution, fail-open |
| Tool inventory / direct tool run | `tools list/show/run` | `src.agent.tools.ToolRegistry` |

## Agent-Internal Command Examples

```bash
python main.py invest-analysis-pro quote AAPL
python main.py invest-analysis-pro history 600519 --days 120 --limit 30
python main.py invest-analysis-pro news 600519 --stock-name 贵州茅台 --limit 5
python main.py invest-analysis-pro market --region cn --include indices,stats,sectors --limit 10
python main.py invest-analysis-pro backtest --stock-code 600519 --items-limit 5
python main.py invest-analysis-pro portfolio --include-positions --limit 20
```

## Recommended Agent Workflow

1. Use `bundle` to prepare the base evidence set.
2. Let the controller agent perform an Evidence Audit over `status`, `coverage`, `source_chain`, `errors`, and `warnings`.
3. Choose `quick`, `standard`, `full`, or `specialist` according to `references/workflow-manifest.json` and the execution guidance in `references/dag-workflow.md`.
4. If the user specified a strategy, call `strategies show <strategy_id>` and pass the strategy YAML to the Strategy Specialist prompt.
5. If no strategy is specified, select up to 3 strategies based on the Technical result. If the market state is unclear, use the default router strategies `bull_trend` and `shrink_pullback`.
6. If news is needed, call `news` or `intel` separately and control payload size with `--limit`.
7. Never dispatch Decision as an independent research task; the calling controller agent must generate the final conclusion using `references/prompts/decision-synthesis.md`, `references/report-standard.md`, and the bundled output assets.
8. When strict acceptance, runtime adaptation, or workflow debugging is needed, validate the workflow run record with `python scripts/check_workflow_compliance.py --input <run-record.json> --strict`.
9. Technical / Intel / Risk / Strategy and related roles are prompt/workflow phases, not a built-in LLM runtime.

## Optional Result Saving

Only when the environment already provides a result-save interface, and only when the user explicitly wants archival, may the controller agent save the completed result after the final report is finished. Example:

```http
POST /api/v1/agent/results
```

Request example:

```json
{
  "stock_code": "600519",
  "stock_name": "贵州茅台",
  "analysis_summary": "Agent-generated summary",
  "report_markdown": "# invest-analysis-pro Research Report",
  "evidence_envelope": {"status": "ok", "task": "bundle"}
}
```

That interface only accepts and stores completed results for review and retrieval. It must not call an LLM and must not trigger a new research flow. Result saving is an optional delivery surface, not the main skill path. Do not start services or call save APIs by default.
