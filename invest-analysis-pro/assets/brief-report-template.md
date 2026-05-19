# 中文简版摘要模板

```markdown
# 🎯 {report_date} invest-analysis-pro 摘要

> {count} tickers | 🟢{buy_count} 🟡{hold_count} 🔴{sell_count}

**{stock_name}({stock_code})** {signal_emoji} {operation_advice} | Score {sentiment_score} | {one_sentence}
**...**

*{generated_at}*
```

Minimum preserved fields:
- ticker
- action bias
- score
- one-sentence conclusion
- generation time
- any confidence downgrade caused by partial evidence
- This template is user-facing. Do not include raw Decision Dashboard JSON by default.
