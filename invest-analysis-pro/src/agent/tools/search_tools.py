# -*- coding: utf-8 -*-
"""
Search tools — wraps SearchService methods as agent-callable tools.

Tools:
- search_stock_news: search latest stock news
- search_comprehensive_intel: multi-dimensional intelligence search
"""

import logging
import time

from src.agent.tools.registry import ToolParameter, ToolDefinition

logger = logging.getLogger(__name__)


def _get_db():
    """Lazy import for DatabaseManager."""
    from src.storage import get_db
    return get_db()


def _get_search_service():
    """Return shared SearchService singleton."""
    from src.search_service import get_search_service
    return get_search_service()


def _canonical_search_code(stock_code: str) -> str:
    from data_provider.base import canonical_stock_code, normalize_stock_code

    return canonical_stock_code(normalize_stock_code(str(stock_code or "").strip()))


def _akshare_stock_news_fallback(stock_code: str, stock_name: str, *, max_results: int = 5, prior_error: str = "") -> dict:
    """Fallback latest-news evidence from the existing AkShare dependency.

    This keeps agent-native CLI news usable when public SearXNG instances are
    rate-limited and no keyed search provider is configured. It is deterministic
    data collection only; it does not call LLMs or synthesize conclusions.
    """
    started = time.time()
    code = str(stock_code or "").strip().upper()
    for prefix in ("SH", "SZ", "BJ"):
        if code.startswith(prefix):
            code = code[len(prefix):]
    if "." in code:
        code = code.split(".", 1)[0]
    try:
        import akshare as ak

        df = ak.stock_news_em(symbol=code)
        if df is None or df.empty:
            return {
                "query": f"{stock_name} {stock_code} 东方财富个股新闻",
                "success": False,
                "error": prior_error or "AkShare stock_news_em returned no results",
            }
        title_col = "新闻标题" if "新闻标题" in df.columns else None
        snippet_col = "新闻内容" if "新闻内容" in df.columns else None
        date_col = "发布时间" if "发布时间" in df.columns else None
        source_col = "文章来源" if "文章来源" in df.columns else None
        url_col = "新闻链接" if "新闻链接" in df.columns else None
        results = []
        for _, row in df.head(max_results).iterrows():
            results.append(
                {
                    "title": str(row.get(title_col, "") if title_col else "").strip(),
                    "snippet": str(row.get(snippet_col, "") if snippet_col else "").strip(),
                    "url": str(row.get(url_col, "") if url_col else "").strip(),
                    "source": str(row.get(source_col, "东方财富") if source_col else "东方财富").strip(),
                    "published_date": str(row.get(date_col, "") if date_col else "").strip(),
                }
            )
        return {
            "query": f"{stock_name} {stock_code} 东方财富个股新闻",
            "provider": "AkShare.stock_news_em",
            "success": True,
            "results_count": len(results),
            "results": results,
            "source_chain": [
                {
                    "provider": "akshare.stock_news_em",
                    "result": "ok",
                    "duration_ms": int((time.time() - started) * 1000),
                }
            ],
            "warnings": [f"search provider fallback used after failure: {prior_error}"] if prior_error else [],
        }
    except Exception as exc:
        logger.warning("AkShare stock news fallback failed for %s: %s", stock_code, exc)
        return {
            "query": f"{stock_name} {stock_code} 东方财富个股新闻",
            "success": False,
            "error": prior_error or f"AkShare stock_news_em failed: {exc}",
        }


def _format_fallback_intel_report(stock_name: str, fallback: dict) -> str:
    lines = [f"【{stock_name} 情报搜索结果】", "", "📰 最新消息 (来源: AkShare.stock_news_em):"]
    for index, item in enumerate(fallback.get("results", [])[:5], 1):
        date_text = f" [{item.get('published_date')}]" if item.get("published_date") else ""
        lines.append(f"  {index}. {item.get('title', '')}{date_text}")
        snippet = str(item.get("snippet", "")).strip()
        if snippet:
            lines.append(f"     {snippet[:150]}...")
    if not fallback.get("results"):
        lines.append("  未找到相关信息")
    lines.extend(
        [
            "",
            "📋 公司公告 / 📈 机构分析 / ⚠️ 风险排查 / 📊 业绩预期 / 🏭 行业分析:",
            "  搜索引擎不可用或无有效结果，本次仅返回个股新闻 fallback；调用方 Agent 不得补编缺失维度。",
        ]
    )
    return "\n".join(lines)


def _persist_news_response(
    *,
    stock_code: str,
    stock_name: str,
    dimension: str,
    response,
) -> None:
    """Best-effort news persistence for Agent search tools."""
    if not response or not getattr(response, "success", False) or not getattr(response, "results", None):
        return

    code = _canonical_search_code(stock_code)
    try:
        saved_count = _get_db().save_news_intel(
            code=code,
            name=stock_name,
            dimension=dimension,
            query=response.query,
            response=response,
            query_context=None,
        )
        logger.info(
            "Agent news intel persisted for %s (dimension=%s, new_records=%s)",
            code,
            dimension,
            saved_count,
        )
    except Exception as exc:
        logger.warning(
            "Agent news intel persistence failed for %s (dimension=%s): %s",
            code,
            dimension,
            exc,
        )


def _handle_search_stock_news(stock_code: str, stock_name: str) -> dict:
    """Search latest news for a stock."""
    service = _get_search_service()

    if not service.is_available:
        return {"error": "No search engine available (no API keys configured)"}

    response = service.search_stock_news(stock_code, stock_name, max_results=5)

    if not response.success:
        fallback = _akshare_stock_news_fallback(
            stock_code,
            stock_name,
            max_results=5,
            prior_error=response.error_message or "search provider failed",
        )
        if fallback.get("success"):
            return fallback
        return {
            "query": response.query,
            "success": False,
            "error": fallback.get("error") or response.error_message,
        }

    _persist_news_response(
        stock_code=stock_code,
        stock_name=stock_name,
        dimension="latest_news",
        response=response,
    )

    return {
        "query": response.query,
        "provider": response.provider,
        "success": True,
        "results_count": len(response.results),
        "results": [
            {
                "title": r.title,
                "snippet": r.snippet,
                "url": r.url,
                "source": r.source,
                "published_date": r.published_date,
            }
            for r in response.results
        ],
    }


search_stock_news_tool = ToolDefinition(
    name="search_stock_news",
    description="Search for the latest news articles about a specific stock. "
                "Requires both stock_code and stock_name for accurate search. "
                "Returns news titles, snippets, sources, and URLs.",
    parameters=[
        ToolParameter(
            name="stock_code",
            type="string",
            description="Stock code, e.g., '600519'",
        ),
        ToolParameter(
            name="stock_name",
            type="string",
            description="Stock name in Chinese, e.g., '贵州茅台'",
        ),
    ],
    handler=_handle_search_stock_news,
    category="search",
)


# ============================================================
# search_comprehensive_intel
# ============================================================

def _handle_search_comprehensive_intel(stock_code: str, stock_name: str) -> dict:
    """Multi-dimensional intelligence search."""
    service = _get_search_service()

    if not service.is_available:
        return {"error": "No search engine available (no API keys configured)"}

    intel_results = service.search_comprehensive_intel(
        stock_code=stock_code,
        stock_name=stock_name,
        max_searches=6,
    )

    if not intel_results:
        fallback = _akshare_stock_news_fallback(stock_code, stock_name, max_results=5, prior_error="Comprehensive intel search returned no results")
        if fallback.get("success"):
            return {
                "report": _format_fallback_intel_report(stock_name, fallback),
                "dimensions": {"latest_news": fallback},
                "warnings": fallback.get("warnings", []),
                "source_chain": fallback.get("source_chain", []),
            }
        return {"error": "Comprehensive intel search returned no results"}

    # Format into readable report
    report = service.format_intel_report(intel_results, stock_name)

    # Also return structured data
    dimensions = {}
    for dim_name, response in intel_results.items():
        if response and response.success:
            _persist_news_response(
                stock_code=stock_code,
                stock_name=stock_name,
                dimension=dim_name,
                response=response,
            )
            dimensions[dim_name] = {
                "query": response.query,
                "results_count": len(response.results),
                "results": [
                    {
                        "title": r.title,
                        "snippet": r.snippet,
                        "source": r.source,
                    }
                    for r in response.results[:3]  # limit to 3 per dimension to save tokens
                ],
            }

    if not dimensions:
        failed_messages = [
            getattr(resp, "error_message", None)
            for resp in intel_results.values()
            if resp is not None and not getattr(resp, "success", False)
        ]
        prior_error = "；".join(str(msg) for msg in failed_messages if msg) or "all intel dimensions returned empty results"
        fallback = _akshare_stock_news_fallback(stock_code, stock_name, max_results=5, prior_error=prior_error)
        if fallback.get("success"):
            return {
                "report": _format_fallback_intel_report(stock_name, fallback),
                "dimensions": {"latest_news": fallback},
                "warnings": fallback.get("warnings", []),
                "source_chain": fallback.get("source_chain", []),
            }

    return {
        "report": report,
        "dimensions": dimensions,
    }


search_comprehensive_intel_tool = ToolDefinition(
    name="search_comprehensive_intel",
    description="Multi-dimensional intelligence search: latest news, market analysis, "
                "risk checking, earnings outlook, and industry trends for a stock. "
                "Returns a formatted report and structured results.",
    parameters=[
        ToolParameter(
            name="stock_code",
            type="string",
            description="Stock code, e.g., '600519'",
        ),
        ToolParameter(
            name="stock_name",
            type="string",
            description="Stock name in Chinese, e.g., '贵州茅台'",
        ),
    ],
    handler=_handle_search_comprehensive_intel,
    category="search",
)


ALL_SEARCH_TOOLS = [
    search_stock_news_tool,
    search_comprehensive_intel_tool,
]
