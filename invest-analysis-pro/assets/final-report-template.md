# 中文标准研究报告模板

```markdown
# 🎯 invest-analysis-pro 研究报告：{report_date}

> 覆盖标的：{count} | 🟢 买入:{buy_count} 🟡 持有:{hold_count} 🔴 卖出:{sell_count}

## 📊 执行摘要
- {stock_name} ({stock_code}): {operation_advice} | Score {sentiment_score} | {trend_prediction}
- ...

---

## {signal_emoji} {stock_name} ({stock_code})

### 🧾 证据审计
- 证据状态：ok|partial|failed
- 覆盖情况：requested / succeeded / failed
- 来源链：{source_chain}
- 关键错误/警告：{errors_warnings}

### 📰 情报与事件
- 最新动态：{dashboard.intelligence.latest_news}
- 情绪摘要：{dashboard.intelligence.sentiment_summary}
- 业绩展望：{dashboard.intelligence.earnings_outlook}
- 正向催化：{dashboard.intelligence.positive_catalysts}
- 风险提示：{dashboard.intelligence.risk_alerts}

### 📌 核心结论
- 决策类型：buy|hold|sell
- 情绪评分：0-100
- 置信等级：高|中|低
- 一句话结论：{dashboard.core_conclusion.one_sentence}
- 时效性：{dashboard.core_conclusion.time_sensitivity}

| 持仓状态 | 建议动作 |
| --- | --- |
| 无持仓 | {dashboard.core_conclusion.position_advice.no_position} |
| 已持仓 | {dashboard.core_conclusion.position_advice.has_position} |

### 📈 市场快照（仅在证据支持时展示）
| 最新价 | 昨收 | 今开 | 最高 | 最低 | 涨跌幅 | 成交量 | 成交额 | 来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

### 📊 数据视角
- 趋势状态：均线结构、趋势强度、偏多/偏空判断
- 价格位置：当前价格、MA5/MA10/MA20、支撑位、压力位、乖离状态
- 量能结构：量比、换手、参与质量
- 筹码结构：获利盘、平均成本、集中度、健康度

### 🧩 分阶段意见
#### 技术面
...
#### 情报面
...
#### 基本面与资金面
...
#### 风险面
...
#### 策略 / 组合（如适用）
...

### 🎯 作战计划
- 理想买点：{dashboard.battle_plan.sniper_points.ideal_buy}
- 次级买点：{dashboard.battle_plan.sniper_points.secondary_buy}
- 止损位：{dashboard.battle_plan.sniper_points.stop_loss}
- 止盈位：{dashboard.battle_plan.sniper_points.take_profit}
- 建议仓位：{dashboard.battle_plan.position_strategy.suggested_position}
- 入场计划：{dashboard.battle_plan.position_strategy.entry_plan}
- 风控要求：{dashboard.battle_plan.position_strategy.risk_control}

### ✅ 行动清单
- ✅ ...
- ⚠️ ...
- ❌ ...

### ⚠️ 风险与失效条件
...

### 🕳️ 数据缺口与后续观察
...
```

Guidance:
- Lead with the conclusion, then justify it with evidence.
- Preserve data-gap and risk disclosures as first-class content.
- Keep user-facing prose in Chinese unless the user requested another language.
- This template is user-facing. Do not paste raw Decision Dashboard JSON into the final report by default.
