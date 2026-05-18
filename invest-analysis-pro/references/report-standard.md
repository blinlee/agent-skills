# invest-analysis-pro 标准报告流程与产出物

本文约束 `invest-analysis-pro` 在拿到 evidence 和各研究任务 opinions 之后的标准输出。最终汇总由**主控会话**完成，不把 Decision 作为独立研究任务派发。

## 标准流程

1. **Evidence Audit**
   - 记录 evidence envelope `status`。
   - 摘要 `coverage.requested/succeeded/failed`。
   - 提取 `source_chain` 中关键来源。
   - 披露影响判断的 `errors` / `warnings`。

2. **DAG Opinion Review**
   - 汇总 Technical / Intel / Fundamentals & Flow / Risk / Strategy / Portfolio 输出。
   - 标注分歧：例如技术面看多但资金流流出、情报中性但风险高。
   - 如果关键 evidence 或研究分支为 partial/failed，结论必须降置信度。

3. **Decision Synthesis**
   - 主控会话使用 `references/prompts/decision-synthesis.md`。
   - 不把 Decision 作为独立研究任务。
   - `decision_type` 只能是 `buy|hold|sell`。
   - 更强或更弱的倾向用 `sentiment_score`、`confidence_level`、自然语言和风险提示表达。

4. **Final Report**
   - 先给结论，再给证据。
   - 把数据缺口和风险作为报告的一等内容。
   - 不把内部数据适配层的确定性数据包装成确定性收益承诺；最终结论必须呈现为研究判断、风险披露和非个性化决策框架。

## 标准产出物

### 1. Markdown 完整报告

完整报告吸收 `templates/report_markdown.j2` 的展示结构：先给统计摘要，再按股票/标的输出情报、核心结论、市场快照、数据透视、作战计划、风险和数据缺口。Agent 不依赖 Jinja2；这里只把模板结构转成当前 Skill 的报告约束。

建议结构：

```markdown
# 🎯 invest-analysis-pro 研究报告：{report_date}

> 分析标的：{count} | 🟢 buy:{buy_count} 🟡 hold:{hold_count} 🔴 sell:{sell_count}

## 📊 总览摘要
- {stock_name}({stock_code})：{operation_advice} | 信号分 {sentiment_score} | {trend_prediction}
- ...

---

## {signal_emoji} {stock_name} ({stock_code})

### 🧾 Evidence Audit
- evidence status：ok|partial|failed
- 覆盖范围：{coverage.requested/succeeded/failed}
- 来源链路：{source_chain}
- 关键 errors/warnings：{errors/warnings}

### 📰 情报与事件
- 最新消息：{dashboard.intelligence.latest_news}
- 情绪摘要：{dashboard.intelligence.sentiment_summary}
- 业绩展望：{dashboard.intelligence.earnings_outlook}
- 正向催化：{dashboard.intelligence.positive_catalysts}
- 风险提示：{dashboard.intelligence.risk_alerts}

### 📌 核心结论
- 决策类型：buy|hold|sell
- 情绪/信号分：0-100
- 置信度：高|中|低
- 一句话结论：{dashboard.core_conclusion.one_sentence}
- 时间敏感度：{dashboard.core_conclusion.time_sensitivity}

| 持仓状态 | 行动建议 |
| --- | --- |
| 空仓者 | {dashboard.core_conclusion.position_advice.no_position} |
| 持仓者 | {dashboard.core_conclusion.position_advice.has_position} |

### 📈 市场快照（如 evidence 支持）
| 当前价 | 前收 | 开盘 | 最高 | 最低 | 涨跌幅 | 成交量 | 成交额 | 来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

### 📊 数据透视
- 趋势状态：均线结构、趋势强度、多空排列。
- 价格位置：现价、MA5/MA10/MA20、支撑位、压力位、乖离状态。
- 量价结构：量比、成交状态、换手率、量能含义。
- 筹码结构：获利比例、平均成本、集中度、健康度。

### 🧩 分阶段研究意见
#### Technical
...
#### Intel
...
#### Fundamentals & Flow
...
#### Risk
...
#### Strategy / Portfolio（如适用）
...

### 🎯 作战计划
- 理想买入点：{dashboard.battle_plan.sniper_points.ideal_buy}
- 次优买入点：{dashboard.battle_plan.sniper_points.secondary_buy}
- 止损位：{dashboard.battle_plan.sniper_points.stop_loss}
- 目标位：{dashboard.battle_plan.sniper_points.take_profit}
- 仓位计划：{dashboard.battle_plan.position_strategy.suggested_position}
- 入场计划：{dashboard.battle_plan.position_strategy.entry_plan}
- 风控计划：{dashboard.battle_plan.position_strategy.risk_control}

### ✅ 行动清单
- ✅ ...
- ⚠️ ...
- ❌ ...

### ⚠️ 风险与失效条件
...

### 🕳️ 数据缺口与后续观察
...
```

### 2. Brief 摘要报告

Brief 形态吸收 `templates/report_brief.j2` 的短摘要结构，适用于用户只要结论、消息窗口空间有限、或最终报告前的中间概览。

```markdown
# 🎯 {report_date} invest-analysis-pro 摘要

> {count} 个标的 | 🟢{buy_count} 🟡{hold_count} 🔴{sell_count}

**{stock_name}({stock_code})** {signal_emoji} {operation_advice} | 分数 {sentiment_score} | {one_sentence}
**...**

*{generated_at}*
```

Brief 必须保留：标的、操作倾向、分数、一句话结论、生成时间；不得省略 partial/failed 对置信度的影响，如有关键缺口，应在一句话后附 `（数据不完整）` 或单独一行说明。

### 3. 短消息 / IM 报告

短消息形态吸收 `templates/report_wechat.j2` 的压缩结构，适用于飞书、企业微信、钉钉、Telegram、Slack 等消息窗口。该形态不是单独分析流程，只是完整报告的压缩表达。

```markdown
## 🎯 {report_date} invest-analysis-pro

> {count} 个标的 | 🟢buy:{buy_count} 🟡hold:{hold_count} 🔴sell:{sell_count}

### {signal_emoji} {signal_text} | {stock_name}({stock_code})
📌 {one_sentence}
📊 业绩/基本面：{earnings_outlook}
💭 情绪：{sentiment_summary}
🚨 风险：{top_1_2_risk_alerts}
✨ 催化：{top_1_2_positive_catalysts}
🎯 理想买入:{ideal_buy} | 🛑 止损:{stop_loss} | 🎊 目标:{take_profit}
🆕 空仓：{no_position}
💼 持仓：{has_position}
⚠️ 重点检查：{top_failed_or_warning_checklist}

*报告时间：{HH:MM}*
```

短消息必须优先保留：一句话结论、主要风险、狙击点/止损点、空仓/持仓差异建议。超过平台长度限制时，优先截断新闻细节和次要催化，不得截断风险与数据缺口。

### 4. Decision Dashboard JSON

主控会话在最终汇总时生成以下 JSON，字段名保持稳定，便于保存、回看或二次处理。

```json
{
    "stock_name": "股票中文名称",
    "sentiment_score": "0-100整数",
    "trend_prediction": "强烈看多/看多/震荡/看空/强烈看空",
    "operation_advice": "买入/加仓/持有/减仓/卖出/观望",
    "decision_type": "buy/hold/sell",
    "confidence_level": "高/中/低",
    "dashboard": {
        "core_conclusion": {
            "one_sentence": "一句话核心结论（30字以内）",
            "signal_type": "🟢买入信号/🟡持有观望/🔴卖出信号/⚠️风险警告",
            "time_sensitivity": "立即行动/今日内/本周内/不急",
            "position_advice": {
                "no_position": "空仓者建议",
                "has_position": "持仓者建议"
            }
        },
        "data_perspective": {
            "trend_status": {"ma_alignment": "", "is_bullish": true, "trend_score": 0},
            "price_position": {"current_price": 0, "ma5": 0, "ma10": 0, "ma20": 0, "bias_ma5": 0, "bias_status": "", "support_level": 0, "resistance_level": 0},
            "volume_analysis": {"volume_ratio": 0, "volume_status": "", "turnover_rate": 0, "volume_meaning": ""},
            "chip_structure": {"profit_ratio": 0, "avg_cost": 0, "concentration": 0, "chip_health": ""}
        },
        "intelligence": {
            "latest_news": "",
            "risk_alerts": [],
            "positive_catalysts": [],
            "earnings_outlook": "",
            "sentiment_summary": ""
        },
        "battle_plan": {
            "sniper_points": {"ideal_buy": "", "secondary_buy": "", "stop_loss": "", "take_profit": ""},
            "position_strategy": {"suggested_position": "", "entry_plan": "", "risk_control": ""},
            "action_checklist": []
        }
    },
    "analysis_summary": "100字综合分析摘要",
    "key_points": "3-5个核心看点，逗号分隔",
    "risk_warning": "风险提示",
    "buy_reason": "操作理由，引用激活技能或风险框架",
    "trend_analysis": "走势形态分析",
    "short_term_outlook": "短期1-3日展望",
    "medium_term_outlook": "中期1-2周展望",
    "technical_analysis": "技术面综合分析",
    "ma_analysis": "均线系统分析",
    "volume_analysis": "量能分析",
    "pattern_analysis": "K线形态分析",
    "fundamental_analysis": "基本面分析",
    "sector_position": "板块行业分析",
    "company_highlights": "公司亮点/风险",
    "news_summary": "新闻摘要",
    "market_sentiment": "市场情绪",
    "hot_topics": "相关热点"
}
```

## 模板字段映射

从 Jinja 报告模板吸收的字段，主控会话应按以下来源填充；缺字段时必须写 `N/A`、`unknown` 或在数据缺口中说明，不得编造。

| 报告字段 | 优先来源 | 缺失处理 |
| --- | --- | --- |
| `{report_date}` / `{generated_at}` | evidence envelope `generated_at` 或当前会话时间 | 标注生成时间不可确认 |
| `{buy_count}` / `{hold_count}` / `{sell_count}` | 各标的 `decision_type` 统计 | 单标的时也要统计为 1/0 |
| `{signal_emoji}` / `{signal_text}` | `decision_type` + `sentiment_score` + `confidence_level` | 使用 ⚠️ 并说明置信度不足 |
| `{one_sentence}` | `dashboard.core_conclusion.one_sentence`，否则 `analysis_summary` | 用主控一句话概括并标注低置信度 |
| 市场快照 | quote / market_snapshot evidence | 没有则整段省略，并在数据缺口说明 |
| 情报与事件 | Intel opinion + `dashboard.intelligence` | 新闻缺失时写 `not_available` |
| 数据透视 | Technical / Fundamentals & Flow opinions + `dashboard.data_perspective` | 逐项写 unknown，不用空表冒充完整 |
| 作战计划 | `dashboard.battle_plan` + Technical key levels | 缺少价格 evidence 时不得给具体价格 |
| 行动清单 | 主控从证据一致性、风险、触发条件生成 | 必须包含 ✅/⚠️/❌ 至少一种状态 |

## 评分标准

### 强烈买入（80-100分）
- ✅ 多个研究分支同时支持积极结论
- ✅ 上行空间、触发条件与风险回报清晰
- ✅ 关键风险已排查，仓位与止损计划明确
- ✅ 重要数据和情报结论彼此一致

### 买入（60-79分）
- ✅ 主信号偏积极，但仍有少量待确认项
- ✅ 允许存在可控风险或次优入场点
- ✅ 需要在报告中明确补充观察条件

### 观望（40-59分）
- ⚠️ 信号分歧较大，或缺乏足够确认
- ⚠️ 风险与机会大致均衡
- ⚠️ 更适合等待触发条件或回避不确定性

### 卖出/减仓（0-39分）
- ❌ 主要结论转弱，风险明显高于收益
- ❌ 触发了止损/失效条件或重大利空
- ❌ 现有仓位更需要保护而不是进攻

## 决策仪表盘核心原则

1. **核心结论先行**：一句话说清该买该卖。
2. **分持仓建议**：空仓者和持仓者给不同建议。
3. **精确狙击点**：给出具体价格或明确说明无法给出具体价格的证据缺口。
4. **检查清单可视化**：用 ✅⚠️❌ 明确显示每项检查结果。
5. **风险优先级**：舆情、财务、流动性、技术破位和数据缺口要醒目标出。

## 可操作性与稳定性约束

- 不得仅因为单日涨跌或评分跨线就在“买入/卖出”之间剧烈切换。
- 操作建议必须同时参考价格位置（支撑/压力位）、量能/筹码、主力资金流向和风险事件。
- 股价位于支撑与压力之间、资金流不明确时，优先输出“持有/震荡/观望/洗盘观察”等可执行的中性建议；`decision_type` 仍保持 `hold`。
- 只有在接近支撑确认或有效突破压力，且资金流/量价配合时，才能给出买入；接近压力且资金流出时不得追买。
- 只有在跌破关键支撑、主力资金持续流出或风险显著放大时，才能给出卖出/减仓。

## 主控归一化检查

主控会话在输出前必须做等价校验：

- 字段完整性：Markdown 报告必须覆盖核心结论、Evidence Audit、分阶段意见、仪表盘、风险、数据缺口。
- 枚举合法性：`decision_type` 只能是 `buy|hold|sell`；无法明确买卖时使用 `hold`。
- 风险降级：重大风险或关键数据失败时，降低 `confidence_level`，并在 `risk_warning` 和数据缺口中明示。
- 数据一致性：价格、支撑/压力、资金流、新闻和策略判断不得互相矛盾；如有分歧，应在报告中解释。
- 可保存性：如需要保存结果，先完成报告和 dashboard JSON，再调用保存接口；保存动作不得改变结论。
