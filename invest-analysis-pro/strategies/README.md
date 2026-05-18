# invest-analysis-pro Strategy Frameworks

This directory stores the strategy YAML files that `invest-analysis-pro` reads during strategy-aware research. These YAML files are not standalone Skills and are not a user-facing command surface. They are rule sources for `specialist` mode and for any workflow that explicitly requests strategy evaluation.

## How the Controller Uses Strategy YAML

1. The controller gathers structured evidence from the internal data adapters.
2. The Technical Analyst establishes market state, key levels, and invalidation conditions.
3. The controller reads one or more `strategies/*.yaml` files in their original form.
4. Each Strategy Specialist evaluates whether the current evidence satisfies one strategy's entry logic and invalidation logic.
5. The controller decides whether to adopt, reject, or downgrade the strategy opinion inside the final report.

## YAML Fields

```yaml
name: bull_trend               # stable strategy ID
display_name: 默认多头趋势       # display name used in reports
description: strategy use case
category: trend                # trend / pattern / reversal / framework
core_rules: [1, 2]             # optional linked concepts
required_tools:                # optional suggested evidence modules
  - get_daily_history
  - analyze_trend
aliases: [趋势突破, 多头排列]     # optional natural-language aliases
default_active: true           # optional candidate in default routing
default_router: false          # optional fallback router candidate
default_priority: 100          # lower number = earlier selection
market_regimes: [trending_up]  # optional regime mapping
instructions: |
  Original strategy rule text. Strategy Specialist should quote or follow these rules directly.
```

## Guardrails

- Do not turn YAML rules into deterministic return promises.
- Do not let strategy framing hide evidence gaps; use `unknown`, `missing`, or lower confidence when needed.
- The strategy rule text should remain high-fidelity because prompt wording is sensitive.
- Additional strategy-YAML directories may be configured internally when needed; this is not part of the user-facing skill surface.
