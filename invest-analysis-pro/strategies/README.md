# invest-analysis-pro 策略框架

本目录保存 `invest-analysis-pro` 给 Agent 读取的策略 YAML。它们不是独立 Skill，也不是面向用户手动执行的入口；它们是 `specialist` 研究模式下 Strategy Specialist 的规则参考。

## Agent 使用方式

1. 主控 Agent 先通过内部数据适配层获取股票 evidence。
2. Technical Analyst 输出趋势、量价、关键位和失效条件。
3. 主控 Agent 读取一个或多个 `strategies/*.yaml` 原文。
4. Strategy Specialist 只判断“当前 evidence 是否适配该策略”，输出结构化 opinion。
5. 最终是否采纳策略，由主控 Agent 在标准报告中综合 Technical / Intel / Fundamentals & Flow / Risk 后决定。

## YAML 字段

```yaml
name: bull_trend                 # 稳定 ID
display_name: 牛市趋势策略        # 展示名
description: 策略适用场景
category: trend                  # trend / pattern / reversal / framework
core_rules: [1, 2]               # 可选：关联核心理念
required_tools:                  # 可选：建议 evidence 模块
  - get_daily_history
  - analyze_trend
aliases: [趋势突破, 多头排列]      # 可选：自然语言别名
default_active: true             # 可选：默认候选
default_router: false            # 可选：fallback 路由候选
default_priority: 100            # 可选：排序，越小越优先
market_regimes: [trending_up]    # 可选：适配行情状态
instructions: |
  策略规则原文。Strategy Specialist 必须优先引用这里的条件、触发点和失效点。
```

## 约束

- 不要把 YAML 里的策略规则包装成确定性收益承诺。
- 不要让策略覆盖 evidence 的缺口；数据缺失时输出 `unknown` 或降低置信度。
- `AGENT_SKILL_DIR` 仍是内部兼容配置名；在产品语义上，它表示“额外策略 YAML 目录”，不是当前 Skill 名称。
