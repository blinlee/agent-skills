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

### 1. Markdown 报告

建议结构：

```markdown
# invest-analysis-pro 研究报告：{stock_code} {stock_name}

## 1. 核心结论
- 决策类型：buy|hold|sell
- 情绪/信号分：0-100
- 置信度：高|中|低
- 一句话结论：...

## 2. Evidence Audit
- evidence status：ok|partial|failed
- 覆盖范围：...
- 来源链路：...
- 关键 errors/warnings：...

## 3. 分阶段研究意见
### Technical
...
### Intel
...
### Fundamentals & Flow
...
### Risk
...
### Strategy / Portfolio（如适用）
...

## 4. 决策仪表盘
- 空仓者：...
- 持仓者：...
- 理想买入点：...
- 次优买入点：...
- 止损位：...
- 目标位：...
- 行动清单：✅ / ⚠️ / ❌

## 5. 风险与失效条件
...

## 6. 数据缺口与后续观察
...
```

### 2. Decision Dashboard JSON

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
