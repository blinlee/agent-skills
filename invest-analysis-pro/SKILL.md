---
name: invest-analysis-pro
description: invest-analysis-pro 是面向 Agent 的投资研究 Skill。当用户要求分析股票、研究公司/代码、市场复盘、新闻情报、资金流/龙虎榜、策略 YAML、回测解释、持仓或风险检查时应使用本 Skill。默认：用户给出股票并要求分析时执行 specialist 完整研究；只有用户明确要求快速/简短时才使用 quick。本 Skill 由 Agent 获取结构化 evidence、按 DAG 组织研究任务，并由主控 Agent 汇总报告；不要要求用户手动运行内部命令。
---

# invest-analysis-pro

## 触发条件

用户请求个股研究、市场复盘、新闻/情报收集、技术面证据、基本面证据、资金流/板块/龙虎榜、持仓风险、回测解释或策略 YAML 参考时使用。

默认规则：**只要用户给出某只股票并要求“看/分析/研究”，就按 specialist 研究模式执行最详细工作流**。quick / standard / full 都不是默认路径，只有用户明确要求降档时才使用。

## 必做流程

1. 识别股票、市场、研究范围和用户是否明确要求降档。
2. 读取 `references/evidence-contract.md`，由 Agent 自行调用内部数据适配层获取 JSON evidence；不要让用户手动敲命令。
3. 读取 envelope 的 `status`、`coverage`、`source_chain`、`errors`、`warnings`。
4. `status=failed` 时不要编造结论；说明失败原因并缩小范围或请求补充输入。
5. `status=partial` 时可以继续分析，但必须披露缺失模块、失败原因和置信度影响。
6. `full/specialist` 完整研究时，按 `references/dag-workflow.md` 组织研究子任务；最终 Decision / 报告由当前主控 Agent 完成，不把 Decision 作为独立研究任务派发。
7. 最终报告按 `references/report-standard.md` 输出。

## 模式选择

| 模式 | 触发 | 研究 DAG | evidence 建议 |
| --- | --- | --- | --- |
| `quick` | 仅用户明确要求快速/简短/大概 | Technical → 主控 Decision | quote、technical、ma、volume，限制大字段 |
| `standard` | 用户明确要求标准档 / standard | Technical + Intel → 主控 Decision | quote、history、technical、ma、volume、pattern，必要时补 news/intel |
| `full` | 用户明确要求完整但不要策略专家 / full | Technical + Intel + Fundamentals & Flow → Risk → 主控 Decision | full evidence：技术、基本面、资金、板块、龙虎榜、新闻/情报 |
| `specialist` | **默认：用户给出股票并要求分析/研究**；或用户明确要求最详细/专家/策略评估 | full + Strategy Specialist(s) → 主控 Decision | full evidence + `strategies/*.yaml`；无指定策略时按行情状态选择最多 3 个策略 |

## specialist 默认研究流程

1. 获取完整 evidence bundle：行情、历史、技术、均线、量价、形态、基本面、资金流、板块、龙虎榜；必要时补新闻/情报。
2. 枚举并读取相关 `strategies/*.yaml`。用户未指定策略时，先按 Technical 结果判断行情状态，再选择最多 3 个 Strategy Specialist；无法判断时使用默认 router 策略 `bull_trend`、`shrink_pullback`。
3. 做 Evidence Audit：确认哪些数据可用、哪些 partial/failed、哪些来源可用于结论。
4. 按 DAG 派发研究子任务。
5. 主控 Agent 汇总所有 opinion，输出标准报告。

## 执行能力降级

按当前 Agent 环境选择最高可用路径：

1. **Local evidence mode**：可以执行本地命令时，优先由 Agent 调用内部数据适配层获取 JSON evidence。
2. **Provided evidence mode**：不能执行本地命令，但用户或外部系统已提供行情、新闻、财务、资金流等结构化数据时，基于已提供 evidence 继续 DAG，并明确数据来源与缺口。
3. **No evidence mode**：既不能执行本地命令，也没有可用 evidence 时，不做假分析；说明缺少哪些 evidence 才能完成研究。

## DAG 子任务语义

如果当前运行环境支持并行或独立研究任务，`standard/full/specialist` 应按 DAG 并行处理可并行分支；如果运行环境不支持并行任务，则在当前会话按同一 DAG 顺序完成，不要跳过分析。

派发规则：

1. **只拆分研究员任务，不拆分 Decision**：Technical / Intel / Fundamentals & Flow / Risk / Strategy / Portfolio 可以作为独立研究任务；最终 Decision Synthesis 和报告写作必须由主控 Agent 完成。
2. **quick**：只做 Technical Analyst，然后主控汇总。
3. **standard 第一波可并行**：Evidence Audit 后，可同时派发 Technical Analyst 和 Intel Analyst。
4. **full 第一波可并行**：Evidence Audit 后，可同时派发 Technical Analyst、Intel Analyst、Fundamentals & Flow Analyst。
5. **Risk Officer 按依赖执行**：必须等待 Technical + Intel + Fundamentals & Flow 输出后再派发。
6. **specialist 策略分支按依赖执行**：Strategy Specialist 必须附带对应 strategy YAML 和 Technical 输出；Portfolio Analyst 仅在组合/持仓任务中执行，且必须附带 portfolio/risk evidence 和单股基础意见。
7. **主控等待依赖完成后汇总**：主控读取所有子任务输出、evidence `coverage/source_chain/errors/warnings`，再按 `references/report-standard.md` 产出最终报告。

## 子任务 payload 模板

派发或模拟研究子任务时使用以下结构，保证每个研究任务只处理自己的职责：

```text
Role: <Technical Analyst | Intel Analyst | Fundamentals & Flow Analyst | Risk Officer | Strategy Specialist | Portfolio Analyst>
Prompt: references/prompts/<role>.md
Stock: <code + name + market if known>
Mode: <quick | standard | full | specialist>
Evidence slices: <只附与该角色相关的 compact JSON evidence；必要时说明缺失模块>
Prior opinions: <none | Technical output | Intel output | Fundamentals & Flow output | Strategy output>
Strategy YAML: <仅 Strategy Specialist 需要；粘贴对应 strategies/*.yaml 内容>
Tool policy: do not call external tools or data adapters unless the controller explicitly authorizes it
Output language: Chinese unless the user requested another language
Required output: JSON only, no markdown fence, follow the prompt contract, no final investment recommendation
Missing-data policy: mark unknown/missing_data and lower confidence; do not invent facts
```

## 任务路由

| 用户意图 | 优先路径 |
| --- | --- |
| 给出股票并要求分析/研究（默认） | `specialist`：完整 evidence + 策略框架 + 研究 DAG |
| 明确要求快速看股票 | `quick`：少量 evidence + Technical |
| 明确要求标准档 | `standard`：Technical + Intel |
| 明确要求 full 但不要策略专家 | `full`：Technical + Intel + Fundamentals & Flow + Risk |
| 新闻/事件/情报 | news/intel evidence + Intel Analyst |
| 大盘/板块 | market/sector evidence + 主控市场复盘 |
| 策略参考 | `strategies/*.yaml` + Strategy Specialist |
| 回测解释 | backtest evidence + Technical/Strategy |
| 持仓风险 | portfolio/risk evidence + Portfolio Analyst |
| 保存研究结果 | 仅在环境提供保存接口且用户需要留档时，由主控保存已完成报告 |

## Gotchas

- 本 Skill 的人类入口是自然语言请求，不是手动 CLI 教程；不要要求用户自己敲命令。
- 内部数据适配层只产出 evidence，不调用 LLM，不生成自然语言报告或投资结论；研究子任务只产出分支 opinion；最终由主控 Agent 输出研究结论、风险披露和非个性化决策框架。
- 不要求配置 OpenAI / Gemini / Anthropic / DeepSeek / LiteLLM key。
- REST API、看板、通知、定时任务或桌面端如存在，只是可选承载或回看能力；默认不启动服务、不调用保存接口。
- 不要忽略 envelope：`coverage`、`source_chain`、`errors`、`warnings` 是证据质量的一部分。
- 数据源可能 partial / failed；不得编造缺失数据。
- 大输出必须使用 compact / full / limit 或等价机制，避免上下文爆炸。
- 不要为了补数据而大范围真实联网抓取；优先小范围、缓存或已有 evidence。
- 公开语义、Skill 名称和报告标题统一使用 `invest-analysis-pro`。

## 内部参考

- 数据适配层契约：`references/evidence-contract.md`
- 研究 DAG：`references/dag-workflow.md`
- 角色 prompt：`references/prompts/*.md`
- 标准报告：`references/report-standard.md`
- 策略框架：`strategies/*.yaml`
