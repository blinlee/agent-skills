# invest-analysis-pro DAG 工作流

本文定义 `invest-analysis-pro` 在拿到 JSON evidence 之后的研究编排。内部数据适配层只负责数据采集、确定性计算和 JSON envelope 输出；研究判断、子任务派发、分歧处理和最终报告由主控 Agent 完成。

## 四档研究 DAG

| 模式 | 触发 | DAG |
| --- | --- | --- |
| `quick` | 用户明确要求快速/简短/大概 | Evidence Audit → Technical Analyst → 主控 Decision |
| `standard` | 用户明确要求标准档 / standard | Evidence Audit → Technical Analyst + Intel Analyst → 主控 Decision |
| `full` | 用户明确要求完整但不要策略专家 / full | Evidence Audit → Technical + Intel + Fundamentals & Flow → Risk Officer → 主控 Decision |
| `specialist` | **默认：用户给出股票并要求分析/研究**；或用户明确要求最详细/专家/策略评估 | full → Strategy Specialist(s) → 主控 Decision；组合/持仓任务可增加 Portfolio Analyst |

## 默认 DAG（specialist）

```text
0. Evidence Bundle
   主控会话获取完整 JSON envelope

        ↓

1. Evidence Audit（主控会话）
   检查 status / coverage / source_chain / errors / warnings，决定哪些分支可执行

        ↓

2. 第一层可并行研究
   ├─ Technical Analyst
   ├─ Intel Analyst
   ├─ Fundamentals & Flow Analyst
   └─ Backtest Analyst（仅用户要求或 evidence 已包含时）

        ↓

3. 第二层依赖研究
   ├─ Risk Officer
   │   依赖 Technical + Intel + Fundamentals & Flow
   │
   ├─ Strategy Specialist(s)
   │   依赖 Technical；部分策略也依赖 Fundamentals & Flow
   │
   └─ Portfolio Analyst（组合任务）
       依赖单股基础意见 / 持仓 evidence

        ↓

4. Decision Synthesis（主控会话完成，不作为独立研究任务）
   主控会话汇总全部子研究意见，按 `references/report-standard.md` 生成标准产出物。
```

默认 `specialist` 中，Strategy Specialist 的策略选择规则：优先使用用户指定策略；否则根据 Technical 结果识别行情状态并选择最多 3 个策略；若无法判断行情状态，使用默认 router 策略 `bull_trend`、`shrink_pullback`。

## 为什么不是全串行

内部数据适配层先统一产出 evidence，多名研究员可以读取同一份事实源，因此第一层研究可以并行：Technical、Intel、Fundamentals & Flow 之间通常不存在强依赖。并行能减少等待时间，也能避免一个研究角色的叙事先入为主影响其他角色。

## 为什么不是全并行

部分节点依赖前序观点：

| 节点 | 依赖 | 原因 |
| --- | --- | --- |
| Risk Officer | Technical / Intel / Fundamentals & Flow | 风险判断要同时看破位、负面事件、资金流、估值和数据缺口。 |
| Strategy Specialist | Technical，必要时 Fundamentals & Flow | YAML 策略通常要先确认趋势、关键价位、量价结构和策略条件。 |
| Portfolio Analyst | 单股基础意见 / 持仓 evidence | 组合风险需要单股信号、置信度和持仓结构。 |
| Decision Synthesis | 全部前序输出 | 最终结论必须综合全部 evidence、分歧和风险。 |

## 子任务派发模板

主控 Agent 派发或模拟研究子任务时使用以下 payload。不要让研究任务重新规划整个工作流，也不要让研究任务输出最终投资结论。

```text
Role: <Technical Analyst | Intel Analyst | Fundamentals & Flow Analyst | Risk Officer | Strategy Specialist | Portfolio Analyst>
Prompt: references/prompts/<role>.md
Stock: <code + name + market if known>
Mode: <quick | standard | full | specialist>
Objective: <本角色本轮要回答的问题>
Evidence slices:
  - envelope.status: <ok|partial|failed>
  - coverage summary: <requested/succeeded/failed>
  - relevant data: <compact JSON 或关键字段摘录>
  - errors/warnings relevant to this role: <list>
Prior opinions: <none | Technical output | Intel output | Fundamentals & Flow output | Risk output>
Strategy YAML: <仅 Strategy Specialist 需要；粘贴对应 strategies/*.yaml 内容>
Tool policy: do not call external tools or data adapters unless the controller explicitly authorizes it
Output language: Chinese unless the user requested another language
Output contract: JSON only; no markdown fence; follow prompt schema; no final report; no final buy/hold/sell decision unless prompt explicitly asks for local signal classification.
Missing-data policy: mark unknown/missing_data, lower confidence, and state what evidence is required to resolve it.
```

## 主控会话职责

主控会话是投委会主席 / 报告作者：

1. 调用内部数据适配层并保存 evidence envelope。
2. 做 Evidence Audit，披露 partial / failed / warnings。
3. 按 DAG 派发可并行子任务。
4. 等待依赖节点完成后再派发 Risk / Strategy / Portfolio。
5. 不把 Decision 作为独立研究任务；主控自行按 `references/prompts/decision-synthesis.md` 和 `references/report-standard.md` 汇总。
6. 如环境提供结果保存接口且用户需要留档，主控可以保存已完成报告；保存动作不得触发新的分析链路。

## 推荐 prompt 文档

- Technical：`references/prompts/technical-analyst.md`
- Intel：`references/prompts/intel-analyst.md`
- Fundamentals & Flow：`references/prompts/fundamentals-flow-analyst.md`
- Risk：`references/prompts/risk-officer.md`
- Strategy：`references/prompts/strategy-specialist.md`
- Portfolio：`references/prompts/portfolio-analyst.md`
- Decision / 主控汇总：`references/prompts/decision-synthesis.md`
- 标准报告：`references/report-standard.md`
