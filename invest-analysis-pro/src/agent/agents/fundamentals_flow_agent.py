# -*- coding: utf-8 -*-
"""
FundamentalsFlowAgent — fundamentals / capital-flow / sector-context specialist.

Responsible for:
- Collecting stock-info / valuation clues
- Reading capital-flow context when available
- Checking board / sector / dragon-tiger context
- Producing a structured opinion for downstream risk/decision stages
"""

from __future__ import annotations

import logging
from typing import Optional

from src.agent.agents.base_agent import BaseAgent
from src.agent.protocols import AgentContext, AgentOpinion
from src.agent.runner import try_parse_json

logger = logging.getLogger(__name__)


class FundamentalsFlowAgent(BaseAgent):
    agent_name = "fundamentals_flow"
    max_steps = 4
    tool_names = [
        "get_stock_info",
        "get_capital_flow",
        "get_board_context",
        "get_dragon_tiger",
        "get_sector_rankings",
    ]

    def system_prompt(self, ctx: AgentContext) -> str:
        return """\
You are a **Fundamentals & Capital Flow Analyst** specialising in A-shares, \
Hong Kong stocks, and US equities.

Your task: evaluate whether company basics, valuation clues, capital flow, \
sector context, and dragon-tiger / board data support or weaken the current \
research case, then output a structured JSON opinion.

## Workflow
1. Fetch stock info / valuation context
2. Check capital flow (A-shares when available)
3. Check board / sector context
4. Check dragon-tiger / leaderboard context if relevant
5. Summarise supportive factors, weakening factors, and missing evidence

## Output Format
Return **only** a JSON object:
{
  "signal": "strong_buy|buy|hold|sell|strong_sell",
  "confidence": 0.0-1.0,
  "fundamental_view": "2-3 sentence view on company basics / valuation / quality",
  "flow_view": "2-3 sentence view on capital flow and crowding",
  "sector_context": "sector / board / market context",
  "positive_factors": ["list supported by evidence"],
  "negative_factors": ["list supported by evidence"],
  "missing_data": ["list unavailable evidence modules"]
}
"""

    def build_user_message(self, ctx: AgentContext) -> str:
        parts = [f"Evaluate fundamentals, capital flow, and sector context for stock **{ctx.stock_code}**"]
        if ctx.stock_name:
            parts[0] += f" ({ctx.stock_name})"
        parts.append(
            "Use get_stock_info, get_capital_flow, get_board_context, "
            "get_sector_rankings, and get_dragon_tiger when relevant. "
            "Mark unavailable evidence explicitly in missing_data."
        )

        for opinion_name in ("technical", "intel"):
            opinion = next((op for op in ctx.opinions if op.agent_name == opinion_name), None)
            if opinion is None:
                continue
            parts.append(f"\n[{opinion_name} summary]\n{opinion.reasoning}")

        return "\n".join(parts)

    def post_process(self, ctx: AgentContext, raw_text: str) -> Optional[AgentOpinion]:
        parsed = try_parse_json(raw_text)
        if parsed is None:
            logger.warning("[FundamentalsFlowAgent] failed to parse opinion JSON")
            return None

        ctx.set_data("fundamentals_flow_opinion", parsed)

        reasoning_parts = [
            str(parsed.get("fundamental_view", "")).strip(),
            str(parsed.get("flow_view", "")).strip(),
            str(parsed.get("sector_context", "")).strip(),
        ]
        reasoning = " ".join(part for part in reasoning_parts if part)

        return AgentOpinion(
            agent_name=self.agent_name,
            signal=parsed.get("signal", "hold"),
            confidence=float(parsed.get("confidence", 0.5)),
            reasoning=reasoning,
            raw_data=parsed,
        )
