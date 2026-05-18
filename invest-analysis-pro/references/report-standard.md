# invest-analysis-pro Standard Report Flow and Deliverables

This document defines the standard outputs for `invest-analysis-pro` **after** the controller agent has received the evidence bundle and the researcher opinions. Final synthesis is always completed by the **controller session**. Decision is never dispatched as an independent research task.

## Standard Flow

1. **Evidence Audit**
   - Record the evidence-envelope `status`.
   - Summarize `coverage.requested / succeeded / failed`.
   - Extract the key sources from `source_chain`.
   - Disclose `errors` / `warnings` that materially affect the conclusion.

2. **DAG Opinion Review**
   - Summarize Technical / Intel / Fundamentals & Flow / Risk / Strategy / Portfolio outputs.
   - Mark disagreements, for example: technicals bullish while capital flow is negative; intelligence neutral while risk is elevated.
   - If key evidence or research branches are `partial` / `failed`, the final conclusion must be downgraded in confidence.

3. **Decision Synthesis**
   - The controller session uses `references/prompts/decision-synthesis.md`.
   - Decision is never dispatched as an independent task.
   - `decision_type` must stay within `buy|hold|sell`.
   - Stronger or weaker conviction should be expressed through `sentiment_score`, `confidence_level`, natural-language explanation, and risk signaling.

4. **Final Report**
   - Lead with the conclusion, then present the evidence.
   - Treat data gaps and risks as first-class report content.
   - Do not turn deterministic adapter outputs into deterministic return promises. Final conclusions must remain research judgments, risk disclosures, and a non-personalized decision framework.

## Standard Deliverables

### 1. Full Markdown Report

The full report absorbs the presentation structure of `templates/report_markdown.j2`: start with a summary, then for each ticker present intelligence, core conclusion, market snapshot, data perspective, action plan, risks, and data gaps. The agent does not depend on Jinja2 at runtime; this file converts the template structure into the current skill's report contract.

Recommended structure:

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

### 2. Brief Summary Report

The brief form absorbs the short-summary structure from `templates/report_brief.j2`. Use it when the user only wants the conclusion, when message-window space is limited, or as a compact overview before the final long-form report.

```markdown
# 🎯 {report_date} invest-analysis-pro 摘要

> {count} 个标的 | 🟢{buy_count} 🟡{hold_count} 🔴{sell_count}

**{stock_name}({stock_code})** {signal_emoji} {operation_advice} | 分数 {sentiment_score} | {one_sentence}
**...**

*{generated_at}*
```

The brief must preserve at minimum: ticker, action bias, score, one-sentence conclusion, and generation time. If a key gap affects confidence, explicitly note it, for example `（数据不完整）`.

### 3. Short-Message / IM Report

The short-message form absorbs the compressed structure from `templates/report_wechat.j2`. It is suitable for Feishu, WeCom, DingTalk, Telegram, Slack, and similar messaging surfaces. This is not a separate analysis pipeline; it is a compressed rendering of the full report.

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

The short-message format must prioritize: the one-sentence conclusion, the main risks, sniper/stop-loss levels, and the different actions for no-position vs has-position. If length limits force truncation, trim news detail and secondary catalysts first; never truncate risks or data-gap disclosures.

### 4. Decision Dashboard JSON

The controller session generates the following JSON during final synthesis. Keep field names stable so the output can be saved, reviewed, or post-processed.

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

## Template Field Mapping

Fields absorbed from the Jinja report templates should be filled by the controller session from the following sources. If a field is unavailable, write `N/A`, `unknown`, or explicitly list it under data gaps; never invent content.

| Report field | Preferred source | Missing-data handling |
| --- | --- | --- |
| `{report_date}` / `{generated_at}` | evidence-envelope `generated_at` or current session time | mark generation time as unconfirmed |
| `{buy_count}` / `{hold_count}` / `{sell_count}` | count of each ticker's `decision_type` | even a single-ticker report must still compute 1/0 counts |
| `{signal_emoji}` / `{signal_text}` | `decision_type` + `sentiment_score` + `confidence_level` | use ⚠️ and explain low confidence |
| `{one_sentence}` | `dashboard.core_conclusion.one_sentence`, otherwise `analysis_summary` | let the controller summarize and mark low confidence |
| Market snapshot | quote / market-snapshot evidence | omit the whole section if missing and disclose it under data gaps |
| Intelligence & events | Intel opinion + `dashboard.intelligence` | if news is missing, write `not_available` |
| Data perspective | Technical / Fundamentals & Flow opinions + `dashboard.data_perspective` | write `unknown` item by item; do not fake a complete table |
| Battle plan | `dashboard.battle_plan` + Technical key levels | do not produce concrete price levels when price evidence is missing |
| Action checklist | generated by the controller from evidence consistency, risks, and trigger conditions | must include at least one of ✅ / ⚠️ / ❌ |

## Scoring Bands

### Strong Buy (80-100)
- ✅ Multiple research branches support the positive conclusion
- ✅ Upside, trigger conditions, and risk/reward are clearly defined
- ✅ Key risks have been screened, and position / stop-loss planning is clear
- ✅ Important data and intelligence conclusions are broadly consistent

### Buy (60-79)
- ✅ Primary signal is positive, but some secondary items still need confirmation
- ✅ Controlled risks or second-best entry conditions may still exist
- ✅ Observation conditions should be explicitly documented in the report

### Hold / Watch (40-59)
- ⚠️ Signals are mixed, or confirmation is still insufficient
- ⚠️ Risks and opportunities are roughly balanced
- ⚠️ Better to wait for triggers or avoid uncertainty

### Sell / Reduce (0-39)
- ❌ Core conclusion has weakened and risk clearly outweighs expected reward
- ❌ Stop-loss / invalidation conditions or material negatives have been triggered
- ❌ Existing positions need protection more than aggression
