# Full Markdown Report Template

```markdown
# 🎯 invest-analysis-pro Research Report: {report_date}

> Covered tickers: {count} | 🟢 buy:{buy_count} 🟡 hold:{hold_count} 🔴 sell:{sell_count}

## 📊 Executive Summary
- {stock_name} ({stock_code}): {operation_advice} | Score {sentiment_score} | {trend_prediction}
- ...

---

## {signal_emoji} {stock_name} ({stock_code})

### 🧾 Evidence Audit
- evidence status: ok|partial|failed
- coverage: requested / succeeded / failed
- source chain: {source_chain}
- key errors/warnings: {errors_warnings}

### 📰 Intelligence and Events
- latest news: {dashboard.intelligence.latest_news}
- sentiment summary: {dashboard.intelligence.sentiment_summary}
- earnings outlook: {dashboard.intelligence.earnings_outlook}
- positive catalysts: {dashboard.intelligence.positive_catalysts}
- risk alerts: {dashboard.intelligence.risk_alerts}

### 📌 Core Conclusion
- decision_type: buy|hold|sell
- sentiment score: 0-100
- confidence level: 高|中|低
- one-sentence conclusion: {dashboard.core_conclusion.one_sentence}
- time sensitivity: {dashboard.core_conclusion.time_sensitivity}

| Position status | Suggested action |
| --- | --- |
| No position | {dashboard.core_conclusion.position_advice.no_position} |
| Has position | {dashboard.core_conclusion.position_advice.has_position} |

### 📈 Market Snapshot (only when evidence supports it)
| Current | Prev close | Open | High | Low | Change % | Volume | Turnover | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

### 📊 Data Perspective
- trend status: MA structure, trend strength, bullish/bearish alignment
- price position: current price, MA5/MA10/MA20, support, resistance, bias state
- volume structure: volume ratio, turnover, participation quality
- chip structure: profit ratio, average cost, concentration, health

### 🧩 Stage Opinions
#### Technical
...
#### Intel
...
#### Fundamentals & Flow
...
#### Risk
...
#### Strategy / Portfolio (when applicable)
...

### 🎯 Battle Plan
- ideal buy: {dashboard.battle_plan.sniper_points.ideal_buy}
- secondary buy: {dashboard.battle_plan.sniper_points.secondary_buy}
- stop loss: {dashboard.battle_plan.sniper_points.stop_loss}
- take profit: {dashboard.battle_plan.sniper_points.take_profit}
- suggested position: {dashboard.battle_plan.position_strategy.suggested_position}
- entry plan: {dashboard.battle_plan.position_strategy.entry_plan}
- risk control: {dashboard.battle_plan.position_strategy.risk_control}

### ✅ Action Checklist
- ✅ ...
- ⚠️ ...
- ❌ ...

### ⚠️ Risks and Invalidation Conditions
...

### 🕳️ Data Gaps and Follow-up Observations
...
```

Guidance:
- Lead with the conclusion, then justify it with evidence.
- Preserve data-gap and risk disclosures as first-class content.
- Keep user-facing prose in Chinese unless the user requested another language.
