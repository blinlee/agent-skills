# invest-analysis-pro evidence 契约

`invest-analysis-pro` 是 evidence-first 的投资研究 Skill。内部数据适配层只负责数据采集、确定性计算、缓存利用、降级处理与结构化 JSON 输出；最终分析、报告、投资判断由调用方 Agent 完成。

## 执行能力分级

按当前 Agent 环境选择最高可用路径：

1. **Local evidence mode**：Agent 可以执行本地命令时，使用内部数据适配层获取 JSON evidence。
2. **Provided evidence mode**：Agent 不能执行本地命令，但用户或外部系统已提供结构化行情、新闻、财务、资金流等数据时，基于已提供 evidence 继续研究，并明确数据来源与缺口。
3. **No evidence mode**：既不能执行本地命令，也没有可用 evidence 时，不输出假分析；说明缺少哪些 evidence 才能完成研究。

## Agent 内部调用入口

```bash
python main.py invest-analysis-pro --help
python main.py invest-analysis-pro <command> --help
```

这些命令由 Agent 在 Skill 工作流中执行，用于获取 evidence；不要要求用户手动运行。若本地命令不可用，切换到 Provided evidence mode 或 No evidence mode。

兼容别名：`python main.py agent ...`、`python main.py iap ...`。文档和用户可见产品名统一使用 `invest-analysis-pro`。

## JSON envelope

所有非 help 内部命令输出统一 JSON：

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

语义：

- `ok`：请求模块完成，未发现结构化错误。
- `partial`：至少一个模块失败或缺数据，但仍有可用 evidence。
- `failed`：参数错误、未知工具、或请求模块全部失败。
- `errors`：外部数据源失败、工具失败、参数错误等可机器读取错误。
- `warnings`：截断、not_supported、缓存不足、info/note 等非致命状态。
- `source_chain`：来自工具结果中的来源、缓存或 fallback 链路。
- `coverage`：请求模块、成功/失败模块、输出模式和 limit。

内部数据适配层不会把缺失数据编造成结论。Agent 应在最终回答中披露 `partial/failed` 和关键 `errors/warnings`。

## 输出大小控制

所有内部命令支持：

- `--limit N`：compact 模式下递归限制列表长度，默认 20。
- `--full`：关闭递归截断，保留完整结构化数据。
- `--compact`：默认开启，用于 Agent 上下文安全。

特别建议在 `history`、`news`、`intel`、`fundamentals`、`bundle` 上使用 `--limit`。

## 内部命令清单

| 能力 | 内部命令 | 复用路径 |
| --- | --- | --- |
| 实时行情 quote | `quote <stock_code>` | `src.agent.tools.data_tools.get_realtime_quote_tool` -> `DataFetcherManager.get_realtime_quote` |
| 历史 K 线 history | `history <stock_code> --days N` | `get_daily_history_tool` -> `src.services.history_loader` + DB cache |
| 技术指标 / trend | `technical <stock_code>` / `trend` | `src.agent.tools.analysis_tools.analyze_trend_tool` |
| 均线 | `ma <stock_code> --periods 5,10,20` | `calculate_ma_tool` |
| 量价 | `volume <stock_code>` | `get_volume_analysis_tool` |
| 形态 | `pattern <stock_code>` | `analyze_pattern_tool` |
| 本地分析 | `local-analysis <stock_code>` | trend + MA + volume + pattern 组合 |
| 筹码 | `chip <stock_code>` | `get_chip_distribution_tool` |
| 基本面 / stock info | `fundamentals <stock_code>` / `stock-info` | `get_stock_info_tool` -> fundamental context |
| 主力资金流 | `capital-flow <stock_code>` | `get_capital_flow_tool` |
| 板块 | `boards <stock_code>` / `sector` | `get_board_context_tool` / `get_sector_rankings_tool` |
| 龙虎榜 | `lhb <stock_code>` / `dragon-tiger` | `get_dragon_tiger_tool` -> fundamental adapter |
| 市场数据 | `market --include indices,stats,sectors,hot` | `market_tools` + `DataFetcherManager` fallback |
| 新闻 | `news <stock_code> --stock-name <name>` | `search_stock_news_tool` |
| 情报 | `intel <stock_code> --stock-name <name>` | `search_comprehensive_intel_tool` |
| 回测 | `backtest [--stock-code X|--strategy-id Y]` | `backtest_tools` + `BacktestService` read-only summaries |
| 持仓 / 风险 | `portfolio` / `risk` | `get_portfolio_snapshot_tool` + portfolio services |
| 策略 YAML | `strategies list/show` | `strategies/*.yaml` |
| 一次性上下文 | `bundle <stock_code> --include ...` | 多工具顺序执行，失败 fail-open |
| 工具枚举/直调 | `tools list/show/run` | `src.agent.tools.ToolRegistry` |

## Agent 内部命令示例

```bash
python main.py invest-analysis-pro quote AAPL
python main.py invest-analysis-pro history 600519 --days 120 --limit 30
python main.py invest-analysis-pro news 600519 --stock-name 贵州茅台 --limit 5
python main.py invest-analysis-pro market --region cn --include indices,stats,sectors --limit 10
python main.py invest-analysis-pro backtest --stock-code 600519 --items-limit 5
python main.py invest-analysis-pro portfolio --include-positions --limit 20
```

## Agent 工作流建议

1. 用 `bundle` 准备基础 evidence。
2. 主控 Agent 执行 Evidence Audit，检查 `status/coverage/source_chain/errors/warnings`。
3. 按 `references/dag-workflow.md` 选择 `quick / standard / full / specialist` 档位：
   - `quick`：Technical → 主控 Decision。
   - `standard`：Technical + Intel → 主控 Decision。
   - `full`：Technical + Intel + Fundamentals & Flow → Risk → 主控 Decision。
   - `specialist`：full + Strategy Specialist(s) → 主控 Decision；这是用户直接给股票要求分析时的默认档；组合/持仓任务可增加 Portfolio。
4. 如用户指定策略，读取 `strategies show <strategy_id>`，并把策略 YAML 提供给 Strategy Specialist prompt。
5. 如果没有指定策略，按 Technical 结果选择最多 3 个策略；无法判断行情状态时使用默认 router 策略 `bull_trend`、`shrink_pullback`。
6. 如需要新闻，单独调用 `news` 或 `intel`，并控制 `--limit`。
7. Decision 不作为独立研究任务派发；最终结论由调用方主控 Agent 按 `references/prompts/decision-synthesis.md` 和 `references/report-standard.md` 生成。
8. Technical / Intel / Risk / Strategy 等是 prompt/workflow 阶段，不是内置 LLM 分析引擎。

## 可选结果保存

只有当环境已经提供结果保存接口，且用户明确需要留档时，主控 Agent 才可以在最终报告完成后保存结果。例如：

```http
POST /api/v1/agent/results
```

请求示例：

```json
{
  "stock_code": "600519",
  "stock_name": "贵州茅台",
  "analysis_summary": "Agent 生成的摘要",
  "report_markdown": "# invest-analysis-pro 研究报告",
  "evidence_envelope": {"status": "ok", "task": "bundle"}
}
```

该接口只接收并保存已完成结果，便于回看；它不会调用 LLM，也不会触发新的研究流程。结果保存是可选承载能力，不是 Skill 主路径；默认不启动服务、不调用保存接口。
