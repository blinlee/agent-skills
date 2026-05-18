# -*- coding: utf-8 -*-
"""
Market tools — wraps DataFetcherManager market-level methods as agent tools.

Tools:
- get_market_indices: major market index data
- get_sector_rankings: sector performance rankings
"""

import logging

from src.agent.tools.registry import ToolParameter, ToolDefinition

logger = logging.getLogger(__name__)


def _get_fetcher_manager():
    """Lazy import to avoid circular deps."""
    from data_provider import DataFetcherManager
    return DataFetcherManager()


# ============================================================
# get_market_indices
# ============================================================

def _handle_get_market_indices(region: str = "cn") -> dict:
    """Get major market indices."""
    manager = _get_fetcher_manager()
    indices = manager.get_main_indices(region=region)

    if not indices:
        return {"error": f"No market index data available for region '{region}'"}

    return {
        "region": region,
        "indices_count": len(indices),
        "indices": indices,
    }


get_market_indices_tool = ToolDefinition(
    name="get_market_indices",
    description="Get major market indices (e.g., Shanghai Composite, Shenzhen Component, "
                "CSI 300 for China; S&P 500, Nasdaq, Dow for US). Provides market overview.",
    parameters=[
        ToolParameter(
            name="region",
            type="string",
            description="Market region: 'cn' for China A-shares, 'hk' for Hong Kong, 'us' for US stocks (default: 'cn')",
            required=False,
            default="cn",
            enum=["cn", "hk", "us"],
        ),
    ],
    handler=_handle_get_market_indices,
    category="market",
)


# ============================================================
# get_sector_rankings
# ============================================================

def _handle_get_sector_rankings(top_n: int = 10) -> dict:
    """Get sector performance rankings."""
    manager = _get_fetcher_manager()
    result = manager.get_sector_rankings(n=top_n)

    if result is None:
        return {"error": "No sector ranking data available"}

    # get_sector_rankings returns Tuple[List[Dict], List[Dict]]
    # (top_sectors, bottom_sectors)
    if isinstance(result, tuple) and len(result) == 2:
        top_sectors, bottom_sectors = result
        return {
            "top_sectors": top_sectors,
            "bottom_sectors": bottom_sectors,
        }
    elif isinstance(result, list):
        return {"sectors": result}
    else:
        return {"data": str(result)}


get_sector_rankings_tool = ToolDefinition(
    name="get_sector_rankings",
    description="Get sector/industry performance rankings. Returns top N and bottom N "
                "sectors by daily change percentage. Useful for sector rotation analysis.",
    parameters=[
        ToolParameter(
            name="top_n",
            type="integer",
            description="Number of top/bottom sectors to return (default: 10)",
            required=False,
            default=10,
        ),
    ],
    handler=_handle_get_sector_rankings,
    category="market",
)


# ============================================================
# get_market_stats / get_hot_stocks
# ============================================================

def _handle_get_market_stats() -> dict:
    """Get broad market up/down statistics through existing fallback paths."""
    manager = _get_fetcher_manager()
    data = manager.get_market_stats()
    if not data:
        return {"error": "No market stats data available"}
    return {"market_stats": data}


get_market_stats_tool = ToolDefinition(
    name="get_market_stats",
    description="Get broad market statistics such as advance/decline counts through existing data-source fallback paths.",
    parameters=[],
    handler=_handle_get_market_stats,
    category="market",
)


def _handle_get_hot_stocks(top_n: int = 10) -> dict:
    """Get hot stock ranking evidence."""
    manager = _get_fetcher_manager()
    data = manager.get_hot_stocks(n=top_n)
    if not data:
        return {"error": "No hot stock ranking data available"}
    return {"top_n": top_n, "hot_stocks": data}


get_hot_stocks_tool = ToolDefinition(
    name="get_hot_stocks",
    description="Get hot stock rankings through existing data-source fallback paths.",
    parameters=[
        ToolParameter(
            name="top_n",
            type="integer",
            description="Number of hot stocks to return (default: 10)",
            required=False,
            default=10,
        ),
    ],
    handler=_handle_get_hot_stocks,
    category="market",
)


ALL_MARKET_TOOLS = [
    get_market_indices_tool,
    get_sector_rankings_tool,
    get_market_stats_tool,
    get_hot_stocks_tool,
]
