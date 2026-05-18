# -*- coding: utf-8 -*-
"""
RiskAgent — dedicated risk screening specialist.

Responsible for:
- Scanning for insider sell-downs, earnings warnings, regulatory actions
- Checking valuation anomalies (PE/PB extremes)
- Evaluating lock-up expiration risks
- Producing risk flags that can override or downgrade signals from other agents

Risk flags use a two-level severity system:
- **soft**: downgrades the signal and adds a visible warning
- **hard**: vetoes buy signals entirely when risk override is enabled
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from src.agent.agents.base_agent import BaseAgent
from src.agent.protocols import AgentContext, AgentOpinion
from src.agent.runner import try_parse_json

logger = logging.getLogger(__name__)


class RiskAgent(BaseAgent):
    agent_name = "risk"
    max_steps = 4
    tool_names = [
        "search_stock_news",
        "get_realtime_quote",
        "get_stock_info",
    ]

    def system_prompt(self, ctx: AgentContext) -> str:
        return """\
You are a **Risk Screening Agent** focused exclusively on identifying \
risks and red flags for the given stock.

Your task: search for and evaluate ALL potential risk factors, then \
output a structured JSON risk assessment.

## Mandatory Risk Checks
1. **Insider / Major Shareholder Activity** — sell-downs (减持), pledges
2. **Earnings Warnings** — pre-loss, downward revisions (业绩预亏, 业绩变脸)
3. **Regulatory** — penalties, investigations, violations (监管处罚, 立案调查)
4. **Industry Policy** — headwinds, sector crackdowns
5. **Lock-up Expirations** — large block unlocks within 30 days (解禁)
6. **Valuation Extremes** — PE > 100 or negative, PB > 10 (flag as anomaly)
7. **Technical Warning Signs** — death crosses, breaking key supports
8. **Cross-opinion Conflicts** — disagreements among technical / intel / fundamentals-flow views
9. **Data Quality Risk** — partial or missing upstream evidence that materially weakens confidence

## Severity Levels
- "high": existential or material risk (lawsuits, fraud, massive insider selling)
- "medium": significant concern (earnings miss, lock-up, sector headwind)
- "low": minor or informational (analyst downgrade, minor insider sale)

## Output Format
Return **only** a JSON object:
{
  "risk_level": "high|medium|low|none",
  "risk_score": 0-100,
  "flags": [
    {
      "category": "insider|earnings|regulatory|industry|lockup|valuation|technical|data_quality|opinion_conflict",
      "severity": "high|medium|low",
      "description": "Clear description of the risk",
      "source": "Where this information came from"
    }
  ],
  "veto_buy": true|false,
  "reasoning": "2-3 sentence overall risk assessment",
  "signal_adjustment": "none|downgrade_one|downgrade_two|veto",
  "missing_data": ["list unavailable evidence modules"]
}

Important: be thorough but factual. Only flag risks backed by evidence \
from your search results or prior opinions. Do NOT invent risks.
"""

    def build_user_message(self, ctx: AgentContext) -> str:
        parts = [f"Screen stock **{ctx.stock_code}**"]
        if ctx.stock_name:
            parts[0] += f" ({ctx.stock_name})"
        parts.append("for ALL risk factors listed in your instructions.")
        parts.append(
            "Use prior opinions first, then search only when you still need missing evidence. "
            "Explicitly assess cross-opinion conflicts and data-quality gaps."
        )

        technical = next((op for op in ctx.opinions if op.agent_name == "technical"), None)
        if technical is not None:
            parts.append(f"\n[Technical opinion]\nSignal={technical.signal} Confidence={technical.confidence:.2f}\n{technical.reasoning}")
            if technical.key_levels:
                parts.append(f"Technical key levels: {json.dumps(technical.key_levels, ensure_ascii=False, default=str)}")

        # Feed any existing intel data so the risk agent doesn't redo searches
        if ctx.get_data("intel_opinion"):
            parts.append(f"\n[Existing intel data]\n{json.dumps(ctx.get_data('intel_opinion'), ensure_ascii=False, default=str)}")
        else:
            intel = next((op for op in ctx.opinions if op.agent_name == "intel"), None)
            if intel is not None:
                parts.append(f"\n[Intel opinion]\nSignal={intel.signal} Confidence={intel.confidence:.2f}\n{intel.reasoning}")

        fundamentals_flow = ctx.get_data("fundamentals_flow_opinion")
        if fundamentals_flow:
            parts.append(f"\n[Fundamentals & flow opinion]\n{json.dumps(fundamentals_flow, ensure_ascii=False, default=str)}")
        else:
            fundamentals = next((op for op in ctx.opinions if op.agent_name == "fundamentals_flow"), None)
            if fundamentals is not None:
                parts.append(
                    f"\n[Fundamentals & flow summary]\nSignal={fundamentals.signal} "
                    f"Confidence={fundamentals.confidence:.2f}\n{fundamentals.reasoning}"
                )

        return "\n".join(parts)

    def post_process(self, ctx: AgentContext, raw_text: str) -> Optional[AgentOpinion]:
        parsed = try_parse_json(raw_text)
        if parsed is None:
            logger.warning("[RiskAgent] failed to parse risk JSON")
            return None

        # Propagate structured risk flags to context
        for flag in parsed.get("flags", []):
            if isinstance(flag, dict):
                ctx.add_risk_flag(
                    category=flag.get("category", "unknown"),
                    description=flag.get("description", ""),
                    severity=flag.get("severity", "medium"),
                )

        return AgentOpinion(
            agent_name=self.agent_name,
            signal=_risk_to_signal(parsed.get("risk_level", "none")),
            confidence=float(parsed.get("risk_score", 50)) / 100.0,
            reasoning=parsed.get("reasoning", ""),
            raw_data=parsed,
        )


def _risk_to_signal(risk_level: str) -> str:
    """Map risk level to a trading signal (inverted)."""
    mapping = {
        "none": "buy",
        "low": "hold",
        "medium": "sell",
        "high": "strong_sell",
    }
    return mapping.get(risk_level, "hold")
