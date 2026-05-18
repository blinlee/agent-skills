# -*- coding: utf-8 -*-
"""
Data tools — wraps DataFetcherManager methods as agent-callable tools.

Tools:
- get_realtime_quote: real-time stock quote
- get_daily_history: historical OHLCV data
- get_chip_distribution: chip distribution analysis
- get_analysis_context: historical analysis context from DB
"""

import logging
import re
import time
from datetime import date, datetime, timedelta
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

from src.agent.tools.registry import ToolParameter, ToolDefinition

logger = logging.getLogger(__name__)

_fetcher_manager_singleton = None
_fetcher_manager_lock = Lock()
_DAILY_HISTORY_DEFAULT_DAYS = 60
_DAILY_HISTORY_MAX_DAYS = 365


def _clean_cn_stock_code(stock_code: str) -> str:
    """Return the 6-digit A-share code expected by AkShare endpoints."""
    code = str(stock_code or "").strip().upper()
    for prefix in ("SH", "SZ", "BJ"):
        if code.startswith(prefix):
            code = code[len(prefix):]
    if "." in code:
        code = code.split(".", 1)[0]
    return code


def _a_share_market(code: str) -> str:
    """Infer AkShare market parameter for A-share per-stock endpoints."""
    return "sh" if str(code).startswith(("5", "6", "9")) else "sz"


def _safe_float_from_row(row: Any, keywords: Tuple[str, ...]) -> Optional[float]:
    """Pick and coerce the first numeric value whose column contains a keyword."""
    try:
        for col in row.index:
            if any(keyword in str(col) for keyword in keywords):
                value = row.get(col)
                if value is None:
                    continue
                parsed = float(value)
                if parsed == parsed:
                    return parsed
    except Exception:
        return None
    return None


def _safe_float(value: Any) -> Optional[float]:
    """Best-effort numeric coercion for AkShare values."""
    if value is None:
        return None
    try:
        if value != value:  # NaN
            return None
    except Exception:
        pass
    text = str(value).strip().replace(",", "").replace("%", "")
    if text in {"", "-", "None", "nan", "NaN"}:
        return None
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _parse_dt(value: Any) -> Optional[datetime]:
    try:
        import pandas as pd

        parsed = pd.to_datetime(value, errors="coerce")
        if pd.isna(parsed):
            return None
        return parsed.to_pydatetime() if hasattr(parsed, "to_pydatetime") else parsed
    except Exception:
        return None


def _sum_recent_numeric(df: Any, value_col: str, count: int) -> Optional[float]:
    try:
        values = [_safe_float(v) for v in df.tail(count)[value_col].tolist()]
    except Exception:
        return None
    values = [v for v in values if v is not None]
    if not values:
        return None
    return float(sum(values))


def _latest_report_period(columns: List[Any]) -> Optional[str]:
    periods = [str(col) for col in columns if re.fullmatch(r"\d{8}", str(col))]
    return max(periods) if periods else None


def _metric_value(metric_rows: Dict[str, Any], keywords: Tuple[str, ...], period: str) -> Optional[float]:
    for metric_name, row in metric_rows.items():
        if any(keyword in metric_name for keyword in keywords):
            return _safe_float(row.get(period))
    return None


def _yoy(latest: Optional[float], previous: Optional[float]) -> Optional[float]:
    if latest is None or previous in (None, 0):
        return None
    return round((latest - previous) / abs(previous) * 100, 4)


def _extract_financial_abstract_enrichment(df: Any) -> Dict[str, Any]:
    """Parse AkShare stock_financial_abstract transposed tables.

    Recent AkShare versions return rows as metrics and columns as report
    periods. The legacy adapter expects one row per report period; keep this
    parser in the agent-native layer so the legacy runtime is not rewritten.
    """
    if df is None or getattr(df, "empty", True):
        return {}
    if "指标" not in getattr(df, "columns", []):
        return {}
    period = _latest_report_period(list(df.columns))
    if not period:
        return {}
    prev_period = f"{int(period[:4]) - 1}{period[4:]}"
    metric_rows = {
        str(row.get("指标") or "").strip(): row
        for _, row in df.iterrows()
        if str(row.get("指标") or "").strip()
    }
    revenue = _metric_value(metric_rows, ("营业总收入", "营业收入", "营收"), period)
    revenue_prev = _metric_value(metric_rows, ("营业总收入", "营业收入", "营收"), prev_period)
    net_profit = _metric_value(metric_rows, ("归母净利润", "归属于母公司", "净利润"), period)
    net_profit_prev = _metric_value(metric_rows, ("归母净利润", "归属于母公司", "净利润"), prev_period)
    operating_cash_flow = _metric_value(metric_rows, ("经营活动产生的现金流量净额", "经营现金流", "经营活动现金流"), period)
    roe = _metric_value(metric_rows, ("净资产收益率", "ROE", "净资产收益"), period)
    gross_margin = _metric_value(metric_rows, ("销售毛利率", "毛利率"), period)

    growth = {
        "report_period": period,
        "revenue_yoy": _yoy(revenue, revenue_prev),
        "net_profit_yoy": _yoy(net_profit, net_profit_prev),
        "roe": roe,
        "gross_margin": gross_margin,
    }
    financial_report = {
        "report_date": f"{period[:4]}-{period[4:6]}-{period[6:]}",
        "revenue": revenue,
        "net_profit_parent": net_profit,
        "operating_cash_flow": operating_cash_flow,
        "roe": roe,
    }
    return {
        "growth": {k: v for k, v in growth.items() if v is not None},
        "financial_report": {k: v for k, v in financial_report.items() if v is not None},
        "source": "akshare.stock_financial_abstract",
    }


def _extract_dividend_history_payload(df: Any) -> Dict[str, Any]:
    """Extract dividend evidence, including explicit no-cash-dividend cases."""
    if df is None or getattr(df, "empty", True):
        return {}
    events: List[Dict[str, Any]] = []
    no_cash_rows = 0
    for _, row in df.iterrows():
        announce_dt = _parse_dt(row.get("公告日期"))
        ex_dt = _parse_dt(row.get("除权除息日"))
        cash_raw = _safe_float(row.get("派息"))
        progress = str(row.get("进度") or "").strip()
        if cash_raw is None or cash_raw <= 0:
            if "不分配" in progress or cash_raw == 0:
                no_cash_rows += 1
            continue
        events.append(
            {
                "announcement_date": announce_dt.date().isoformat() if announce_dt else None,
                "ex_dividend_date": ex_dt.date().isoformat() if ex_dt else None,
                # AkShare's A-share history endpoint reports cash dividend per
                # 10 shares; keep pre-tax per-share semantics for downstream use.
                "cash_dividend_per_share": round(cash_raw / 10.0, 6),
                "raw_cash_dividend_per_10_shares": cash_raw,
                "progress": progress or None,
            }
        )
    if events:
        events.sort(key=lambda item: item.get("announcement_date") or "", reverse=True)
        one_year_ago = datetime.now().date() - timedelta(days=365)
        ttm_events = [
            item for item in events
            if (dt := _parse_dt(item.get("ex_dividend_date") or item.get("announcement_date")))
            and dt.date() >= one_year_ago
        ]
        return {
            "events": events[:5],
            "ttm_event_count": len(ttm_events),
            "ttm_cash_dividend_per_share": round(sum(float(item.get("cash_dividend_per_share") or 0.0) for item in ttm_events), 6) if ttm_events else None,
            "coverage": "cash_dividend_pre_tax",
        }
    if no_cash_rows:
        return {
            "events": [],
            "ttm_event_count": 0,
            "ttm_cash_dividend_per_share": 0.0,
            "coverage": "queried_no_cash_dividend",
            "status": "no_cash_dividend",
            "note": "AkShare dividend history returned no cash distribution rows for the queried stock.",
        }
    return {}


def _filter_rows_by_stock_code(df: Any, stock_code: str) -> Any:
    if df is None or getattr(df, "empty", True):
        return df
    code = _clean_cn_stock_code(stock_code)
    for col in getattr(df, "columns", []):
        if any(keyword in str(col) for keyword in ("股票代码", "证券代码", "代码", "symbol", "ts_code")):
            try:
                matched = df[df[col].astype(str).map(_clean_cn_stock_code) == code]
                if not matched.empty:
                    return matched
            except Exception:
                continue
    return df.iloc[0:0]


def _current_report_period_candidates(max_count: int = 3) -> List[str]:
    today = datetime.now().date()
    periods: List[str] = []
    for year in (today.year, today.year - 1):
        for md in ("0331", "0630", "0930", "1231"):
            d = date(year, int(md[:2]), int(md[2:]))
            if d <= today:
                periods.append(f"{year}{md}")
    return sorted(periods, reverse=True)[:max_count]


def _extract_first_text(row: Any, keywords: Tuple[str, ...], limit: int = 240) -> str:
    for col in getattr(row, "index", []):
        if any(keyword in str(col) for keyword in keywords):
            value = str(row.get(col) or "").strip()
            if value and value not in {"-", "None", "nan"}:
                return value[:limit]
    return ""


def _format_quick_report_summary(row: Any, limit: int = 260) -> str:
    parts: List[str] = []
    stock_name = str(row.get("股票简称") or "").strip()
    notice_date = row.get("公告日期")
    if stock_name:
        parts.append(stock_name)
    if notice_date is not None and str(notice_date).strip() not in {"", "NaT", "nan"}:
        parsed = _parse_dt(notice_date)
        parts.append(f"公告日期 {parsed.date().isoformat() if parsed else str(notice_date)[:10]}")
    for label, col in (
        ("营业收入", "营业收入-营业收入"),
        ("营收同比", "营业收入-同比增长"),
        ("净利润", "净利润-净利润"),
        ("净利润同比", "净利润-同比增长"),
        ("ROE", "净资产收益率"),
    ):
        value = row.get(col) if col in getattr(row, "index", []) else None
        parsed_value = _safe_float(value)
        if parsed_value is not None:
            suffix = "%" if "同比" in label or label == "ROE" else ""
            parts.append(f"{label} {round(parsed_value, 4)}{suffix}")
    return "；".join(parts)[:limit]


def _fetch_earnings_disclosure_probe(stock_code: str, periods: Optional[List[str]] = None) -> Dict[str, Any]:
    """Probe date-based forecast/quick-report endpoints and record no-match evidence."""
    code = _clean_cn_stock_code(stock_code)
    if not (len(code) == 6 and code.isdigit()):
        return {}
    periods = periods or _current_report_period_candidates(max_count=3)
    checked: List[Dict[str, Any]] = []
    forecast_summary = ""
    quick_report_summary = ""
    try:
        import akshare as ak
    except Exception as exc:
        return {"status": "failed", "error": f"import_akshare:{type(exc).__name__}"}

    for period in periods:
        for provider, attr, text_keys in (
            ("akshare.stock_yjyg_em", "stock_yjyg_em", ("业绩变动", "业绩变动原因", "预告类型")),
            ("akshare.stock_yjkb_em", "stock_yjkb_em", ("营业收入-同比增长", "净利润-同比增长", "公告日期")),
        ):
            started = time.time()
            try:
                df = getattr(ak, attr)(date=period)
                matched = _filter_rows_by_stock_code(df, code)
                checked.append(
                    {
                        "provider": provider,
                        "period": period,
                        "result": "matched" if matched is not None and not matched.empty else "no_record",
                        "duration_ms": int((time.time() - started) * 1000),
                    }
                )
                if matched is not None and not matched.empty:
                    row = matched.iloc[0]
                    text = _extract_first_text(row, text_keys)
                    if attr == "stock_yjyg_em" and text:
                        forecast_summary = forecast_summary or text
                    if attr == "stock_yjkb_em":
                        quick_report_summary = quick_report_summary or _format_quick_report_summary(row)
            except Exception as exc:
                checked.append(
                    {
                        "provider": provider,
                        "period": period,
                        "result": "failed",
                        "duration_ms": int((time.time() - started) * 1000),
                        "error": f"{type(exc).__name__}: {str(exc)[:160]}",
                    }
                )
    payload: Dict[str, Any] = {"checked": checked}
    if forecast_summary:
        payload["forecast_summary"] = forecast_summary
    if quick_report_summary:
        payload["quick_report_summary"] = quick_report_summary
    if not forecast_summary and not quick_report_summary:
        payload["status"] = "no_record"
        payload["note"] = "No matching rows found in checked date-based AkShare forecast/quick-report endpoints."
    return payload


def _fetch_shareholder_count_payload(stock_code: str) -> Dict[str, Any]:
    code = _clean_cn_stock_code(stock_code)
    if not (len(code) == 6 and code.isdigit()):
        return {}
    try:
        import akshare as ak
        import pandas as pd

        df = ak.stock_zh_a_gdhs_detail_em(symbol=code)
        matched = _filter_rows_by_stock_code(df, code)
        if matched is None or matched.empty:
            return {}
        date_col = "股东户数统计截止日"
        if date_col in matched.columns:
            matched = matched.copy()
            matched[date_col] = pd.to_datetime(matched[date_col], errors="coerce")
            matched = matched.dropna(subset=[date_col]).sort_values(date_col)
        row = matched.iloc[-1]
        shareholder_date = row.get(date_col)
        if hasattr(shareholder_date, "date"):
            shareholder_date = shareholder_date.date().isoformat()
        return {
            "shareholder_count_date": shareholder_date,
            "shareholder_count": _safe_float(row.get("股东户数-本次")),
            "shareholder_count_change": _safe_float(row.get("股东户数-增减")),
            "shareholder_count_change_pct": _safe_float(row.get("股东户数-增减比例")),
            "source": "akshare.stock_zh_a_gdhs_detail_em",
        }
    except Exception as exc:
        logger.warning("shareholder count fallback failed for %s: %s", stock_code, exc)
        return {}


def _enrich_agent_native_fundamentals(stock_code: str, compact_context: dict) -> Tuple[dict, List[str], List[Dict[str, Any]]]:
    """Patch missing agent-native fundamental blocks without touching legacy runtime."""
    warnings: List[str] = []
    source_chain: List[Dict[str, Any]] = []
    code = _clean_cn_stock_code(stock_code)
    if not (len(code) == 6 and code.isdigit()):
        return compact_context, warnings, source_chain
    try:
        import akshare as ak

        started = time.time()
        try:
            enrichment = _extract_financial_abstract_enrichment(ak.stock_financial_abstract(symbol=code))
        except Exception as exc:
            enrichment = {}
            warnings.append(f"financial abstract enrichment failed: {type(exc).__name__}: {str(exc)[:120]}")
        if enrichment:
            source_chain.append({"provider": enrichment["source"], "result": "ok", "duration_ms": int((time.time() - started) * 1000)})
            growth = enrichment.get("growth") or {}
            report = enrichment.get("financial_report") or {}
            if growth and not compact_context.get("growth", {}).get("data"):
                compact_context["growth"] = {"status": "ok", "data": growth}
                compact_context.setdefault("coverage", {})["growth"] = "ok"
            if report:
                earnings = compact_context.setdefault("earnings", {"status": "partial", "data": {}})
                earnings.setdefault("data", {})["financial_report"] = report
                earnings["status"] = "ok" if earnings.get("status") in {"failed", "not_supported", None} else earnings.get("status")
                compact_context.setdefault("coverage", {})["earnings"] = earnings["status"]

        earnings_probe = _fetch_earnings_disclosure_probe(code)
        if earnings_probe:
            earnings = compact_context.setdefault("earnings", {"status": "partial", "data": {}})
            earnings_data = earnings.setdefault("data", {})
            if earnings_probe.get("forecast_summary"):
                earnings_data["forecast_summary"] = earnings_probe["forecast_summary"]
            if earnings_probe.get("quick_report_summary"):
                earnings_data["quick_report_summary"] = earnings_probe["quick_report_summary"]
            earnings_data["earnings_disclosure_probe"] = earnings_probe
            if earnings_probe.get("status") == "no_record" and not (earnings_probe.get("forecast_summary") or earnings_probe.get("quick_report_summary")):
                earnings["status"] = "partial" if earnings_data.get("financial_report") else "no_record"
                warnings.append("earnings forecast/quick-report endpoints checked but no matching stock rows found.")
            else:
                earnings["status"] = "ok"
            compact_context.setdefault("coverage", {})["earnings"] = earnings["status"]

        try:
            dividend_payload = _extract_dividend_history_payload(ak.stock_history_dividend_detail(symbol=code, indicator="分红", date=""))
        except Exception as exc:
            dividend_payload = {}
            warnings.append(f"dividend history enrichment failed: {type(exc).__name__}: {str(exc)[:120]}")
        if dividend_payload:
            earnings = compact_context.setdefault("earnings", {"status": "partial", "data": {}})
            earnings.setdefault("data", {})["dividend"] = dividend_payload
            if earnings.get("status") in {"failed", "not_supported", None}:
                earnings["status"] = "partial"
            compact_context.setdefault("coverage", {})["earnings"] = earnings["status"]
            source_chain.append({"provider": "akshare.stock_history_dividend_detail", "result": "ok"})

        shareholder_payload = _fetch_shareholder_count_payload(code)
        if shareholder_payload:
            institution = compact_context.setdefault("institution", {"status": "partial", "data": {}})
            institution.setdefault("data", {})["shareholder_count"] = shareholder_payload
            institution["status"] = "partial"
            compact_context.setdefault("coverage", {})["institution"] = "partial"
            source_chain.append({"provider": "akshare.stock_zh_a_gdhs_detail_em", "result": "ok"})
    except Exception as exc:
        warnings.append(f"agent-native fundamental enrichment failed: {type(exc).__name__}: {str(exc)[:120]}")
    if any(compact_context.get(block, {}).get("data") for block in ("growth", "earnings", "institution")):
        if compact_context.get("status") in {"failed", "not_supported", None}:
            compact_context["status"] = "partial"
    return compact_context, warnings, source_chain


def _fallback_stock_capital_flow_context(stock_code: str, prior_errors: Optional[List[str]] = None) -> Optional[dict]:
    """Fast agent-native fallback for per-stock capital flow.

    The legacy fundamental adapter fetches both per-stock flow and sector flow
    inside one timeout budget. When a sector-flow endpoint stalls, the whole
    adapter can time out and discard already available per-stock flow. This
    fallback keeps the agent-native CLI useful without changing the legacy
    runtime path.
    """
    started = time.time()
    code = _clean_cn_stock_code(stock_code)
    if not (len(code) == 6 and code.isdigit()):
        return None

    try:
        import akshare as ak
        import pandas as pd

        df = ak.stock_individual_fund_flow(stock=code, market=_a_share_market(code))
        if df is None or df.empty:
            return None
        date_col = next((c for c in df.columns if "日期" in str(c) or "date" in str(c).lower()), None)
        if date_col:
            work_df = df.copy()
            work_df[date_col] = pd.to_datetime(work_df[date_col], errors="coerce")
            work_df = work_df.dropna(subset=[date_col]).sort_values(date_col)
            row = work_df.iloc[-1] if not work_df.empty else df.iloc[-1]
            latest_date = row.get(date_col)
            latest_date = latest_date.date().isoformat() if hasattr(latest_date, "date") else str(latest_date)
        else:
            work_df = df
            row = df.iloc[-1]
            latest_date = None
        main_flow_col = next(
            (
                col for col in work_df.columns
                if any(keyword in str(col) for keyword in ("主力净流入-净额", "主力净流入", "净流入", "净额"))
            ),
            None,
        )
        stock_flow = {
            "main_net_inflow": _safe_float_from_row(row, ("主力净流入-净额", "主力净流入", "净流入", "净额")),
            "inflow_5d": (
                _safe_float_from_row(row, ("5日", "五日"))
                if _safe_float_from_row(row, ("5日", "五日")) is not None
                else (_sum_recent_numeric(work_df, main_flow_col, 5) if main_flow_col else None)
            ),
            "inflow_10d": (
                _safe_float_from_row(row, ("10日", "十日"))
                if _safe_float_from_row(row, ("10日", "十日")) is not None
                else (_sum_recent_numeric(work_df, main_flow_col, 10) if main_flow_col else None)
            ),
            "latest_date": latest_date,
        }
        if not any(value is not None for value in stock_flow.values()):
            return None
        return {
            "status": "partial",
            "coverage": {"status": "partial"},
            "source_chain": [
                {
                    "provider": "akshare.stock_individual_fund_flow",
                    "result": "ok",
                    "duration_ms": int((time.time() - started) * 1000),
                }
            ],
            "errors": list(prior_errors or []),
            "warnings": ["sector capital-flow rankings unavailable; returned per-stock capital flow fallback."],
            "data": {
                "stock_flow": stock_flow,
                "sector_rankings": {"top": [], "bottom": []},
            },
        }
    except Exception as exc:
        logger.warning("capital_flow fallback failed for %s: %s", stock_code, exc)
        return None


def _fallback_dragon_tiger_context(stock_code: str, lookback_days: int = 20, prior_errors: Optional[List[str]] = None) -> Optional[dict]:
    """Fast agent-native fallback for dragon-tiger statistics."""
    started = time.time()
    code = _clean_cn_stock_code(stock_code)
    if not (len(code) == 6 and code.isdigit()):
        return None
    try:
        import akshare as ak
        import pandas as pd

        df = ak.stock_lhb_stock_statistic_em()
        if df is None or df.empty:
            return None
        code_cols = [c for c in df.columns if any(k in str(c) for k in ("代码", "股票代码", "证券代码"))]
        matched = df.iloc[0:0]
        for col in code_cols:
            normalized_codes = df[col].astype(str).map(_clean_cn_stock_code)
            cur = df[normalized_codes == code]
            if not cur.empty:
                matched = cur
                break
        latest_date = None
        recent_count = 0
        is_on_list = False
        if not matched.empty:
            date_col = next((c for c in matched.columns if any(k in str(c) for k in ("最近上榜日", "上榜日", "日期", "交易日"))), None)
            parsed_dates = []
            if date_col:
                parsed_dates = [d for d in pd.to_datetime(matched[date_col], errors="coerce").tolist() if not pd.isna(d)]
            now = datetime.now()
            start = now - timedelta(days=max(1, int(lookback_days or 20)))
            recent_dates = [d.to_pydatetime() if hasattr(d, "to_pydatetime") else d for d in parsed_dates if start <= (d.to_pydatetime() if hasattr(d, "to_pydatetime") else d) <= now]
            is_on_list = bool(recent_dates)
            recent_count = len(recent_dates) if recent_dates else int(len(matched))
            if recent_dates:
                latest_date = max(recent_dates).date().isoformat()
            elif parsed_dates:
                latest = max(parsed_dates)
                latest_date = latest.date().isoformat() if hasattr(latest, "date") else str(latest)
        return {
            "status": "ok",
            "coverage": {"status": "ok"},
            "source_chain": [
                {
                    "provider": "akshare.stock_lhb_stock_statistic_em",
                    "result": "ok",
                    "duration_ms": int((time.time() - started) * 1000),
                }
            ],
            "errors": [],
            "warnings": [f"dragon-tiger primary source failed; fallback used: {err}" for err in (prior_errors or [])],
            "data": {
                "is_on_list": is_on_list,
                "recent_count": recent_count,
                "latest_date": latest_date,
            },
        }
    except Exception as exc:
        logger.warning("dragon_tiger fallback failed for %s: %s", stock_code, exc)
        return None


def _fetch_dragon_tiger_details(stock_code: str, lookback_days: int = 20) -> Dict[str, Any]:
    """Fetch current-window dragon-tiger details for the agent-native path."""
    code = _clean_cn_stock_code(stock_code)
    if not (len(code) == 6 and code.isdigit()):
        return {}
    try:
        import akshare as ak
    except Exception as exc:
        return {"status": "failed", "error": f"import_akshare:{type(exc).__name__}"}

    end = datetime.now().date()
    start = end - timedelta(days=max(1, int(lookback_days or 20)))
    start_s = start.strftime("%Y%m%d")
    end_s = end.strftime("%Y%m%d")
    records: List[Dict[str, Any]] = []
    source_chain: List[Dict[str, Any]] = []
    errors: List[str] = []

    for provider, kwargs in (
        ("akshare.stock_lhb_detail_em", {"start_date": start_s, "end_date": end_s}),
        ("akshare.stock_lhb_jgmmtj_em", {"start_date": start_s, "end_date": end_s}),
    ):
        started = time.time()
        try:
            fn = getattr(ak, provider.split(".")[-1])
            df = fn(**kwargs)
            matched = _filter_rows_by_stock_code(df, code)
            source_chain.append(
                {
                    "provider": provider,
                    "result": "matched" if matched is not None and not matched.empty else "no_record",
                    "duration_ms": int((time.time() - started) * 1000),
                    "window": f"{start_s}-{end_s}",
                }
            )
            if matched is not None and not matched.empty:
                keep_cols = [
                    col for col in matched.columns
                    if any(key in str(col) for key in ("代码", "名称", "上榜日", "上榜日期", "解读", "龙虎榜", "机构", "上榜原因", "买入", "卖出", "净额"))
                ]
                for _, row in matched.head(10).iterrows():
                    records.append({str(col): row.get(col) for col in keep_cols})
        except Exception as exc:
            errors.append(f"{provider}:{type(exc).__name__}:{str(exc)[:160]}")
            source_chain.append(
                {
                    "provider": provider,
                    "result": "failed",
                    "duration_ms": int((time.time() - started) * 1000),
                    "window": f"{start_s}-{end_s}",
                }
            )
    return {
        "status": "ok" if records else "no_record",
        "window": {"start_date": start.isoformat(), "end_date": end.isoformat(), "lookback_days": lookback_days},
        "records": records,
        "source_chain": source_chain,
        "errors": errors,
    }


def _fallback_sector_rankings_context(prior_errors: Optional[List[str]] = None) -> Optional[dict]:
    """Fast agent-native fallback for sector rankings via AkShare Sina endpoint."""
    started = time.time()
    try:
        import akshare as ak
        import pandas as pd

        df = ak.stock_sector_spot(indicator="行业")
        if df is None or df.empty:
            return None
        name_col = "板块" if "板块" in df.columns else next((c for c in df.columns if "name" in str(c).lower()), None)
        change_col = "涨跌幅" if "涨跌幅" in df.columns else next((c for c in df.columns if "pct" in str(c).lower()), None)
        if not name_col or not change_col:
            return None
        work_df = df[[name_col, change_col]].copy()
        work_df[change_col] = pd.to_numeric(work_df[change_col], errors="coerce")
        work_df = work_df.dropna(subset=[change_col])
        if work_df.empty:
            return None
        top = work_df.nlargest(5, change_col)
        bottom = work_df.nsmallest(5, change_col)
        return {
            "status": "ok",
            "coverage": {"status": "ok"},
            "source_chain": [
                {
                    "provider": "akshare.stock_sector_spot",
                    "result": "ok",
                    "duration_ms": int((time.time() - started) * 1000),
                }
            ],
            "errors": [],
            "data": {
                "top": [{"name": str(row[name_col]), "change_pct": float(row[change_col])} for _, row in top.iterrows()],
                "bottom": [{"name": str(row[name_col]), "change_pct": float(row[change_col])} for _, row in bottom.iterrows()],
            },
            "warnings": ["sector ranking fallback used after primary board context failed."]
            + [f"primary board context failed: {err}" for err in (prior_errors or [])],
        }
    except Exception as exc:
        logger.warning("sector ranking fallback failed: %s", exc)
        return None


def _fallback_belong_boards(stock_code: str) -> List[Dict[str, Any]]:
    """Fallback board membership from AkShare stock basic info."""
    code = _clean_cn_stock_code(stock_code)
    if not (len(code) == 6 and code.isdigit()):
        return []
    try:
        import akshare as ak

        df = ak.stock_individual_info_em(symbol=code, timeout=8)
        if df is None or df.empty or not {"item", "value"}.issubset(set(df.columns)):
            return []
        info = {str(row["item"]): row["value"] for _, row in df.iterrows()}
        industry = str(info.get("行业") or "").strip()
        if industry:
            return [{"name": industry, "code": None, "source": "akshare.stock_individual_info_em"}]
    except Exception as exc:
        logger.warning("belong_boards fallback failed for %s: %s", stock_code, exc)
    return []


def _get_fetcher_manager():
    """Return a module-level singleton DataFetcherManager.

    Re-creating the manager on every tool call causes Tushare re-init overhead
    (~2 s each) and prevents circuit-breaker cooldown from taking effect across
    consecutive tool calls within the same agent run.
    """
    from data_provider import DataFetcherManager
    global _fetcher_manager_singleton
    if _fetcher_manager_singleton is None:
        with _fetcher_manager_lock:
            if _fetcher_manager_singleton is None:
                _fetcher_manager_singleton = DataFetcherManager()
    return _fetcher_manager_singleton


def reset_fetcher_manager() -> None:
    """Clear the cached DataFetcherManager so runtime config reloads take effect."""
    global _fetcher_manager_singleton
    with _fetcher_manager_lock:
        _fetcher_manager_singleton = None


def _get_db():
    """Lazy import for DatabaseManager."""
    from src.storage import get_db
    return get_db()


def _normalize_history_days(days: Any) -> Tuple[int, Dict[str, Any]]:
    """Normalize LLM-provided history window and return response metadata."""
    requested_days = days
    warning = None
    try:
        if isinstance(days, bool):
            raise ValueError("bool is not a valid days value")
        effective_days = int(days)
    except (TypeError, ValueError):
        effective_days = _DAILY_HISTORY_DEFAULT_DAYS
        warning = (
            f"Invalid days value {requested_days!r}; "
            f"using default {_DAILY_HISTORY_DEFAULT_DAYS}."
        )

    if effective_days < 1:
        effective_days = 1
        warning = f"days must be >= 1; using {effective_days}."
    elif effective_days > _DAILY_HISTORY_MAX_DAYS:
        effective_days = _DAILY_HISTORY_MAX_DAYS
        warning = f"days exceeds max {_DAILY_HISTORY_MAX_DAYS}; truncated."

    metadata: Dict[str, Any] = {}
    if warning is not None:
        metadata.update(
            {
                "warning": warning,
                "requested_days": requested_days,
                "effective_days": effective_days,
            }
        )
    return effective_days, metadata


def _history_code_candidates(stock_code: str) -> Tuple[List[str], str]:
    """Return cache lookup candidates plus canonical write code."""
    from data_provider.base import canonical_stock_code, normalize_stock_code

    raw_code = str(stock_code or "").strip()
    normalized_code = canonical_stock_code(normalize_stock_code(raw_code))
    candidates: List[str] = []
    for candidate in (canonical_stock_code(raw_code), normalized_code):
        if candidate and candidate not in candidates:
            candidates.append(candidate)
    return candidates, normalized_code


def _append_history_metadata(response: dict, metadata: Dict[str, Any]) -> dict:
    if metadata:
        response.update(metadata)
    return response


def _compact_fundamental_context(fundamental_context: dict) -> dict:
    """Reduce token footprint for tool responses while keeping key semantics."""
    if not isinstance(fundamental_context, dict):
        return {}
    blocks = (
        "valuation",
        "growth",
        "earnings",
        "institution",
        "capital_flow",
        "dragon_tiger",
        "boards",
    )
    compact = {
        "market": fundamental_context.get("market"),
        "status": fundamental_context.get("status"),
        "coverage": fundamental_context.get("coverage", {}),
    }
    for block in blocks:
        payload = fundamental_context.get(block, {})
        if isinstance(payload, dict):
            compact[block] = {
                "status": payload.get("status"),
                "data": payload.get("data", {}),
            }
        else:
            compact[block] = {"status": "failed", "data": {}}
    return compact


def _compact_portfolio_snapshot(snapshot: dict, include_positions: bool = False, top_n: int = 5) -> dict:
    """Shrink portfolio snapshot payload for default tool responses."""
    if not isinstance(snapshot, dict):
        return {}
    compact_accounts = []
    for account in snapshot.get("accounts", []) or []:
        if not isinstance(account, dict):
            continue
        positions = list(account.get("positions") or [])
        positions = sorted(
            positions,
            key=lambda item: float((item or {}).get("market_value_base") or 0.0),
            reverse=True,
        )
        account_payload = {
            "account_id": account.get("account_id"),
            "account_name": account.get("account_name"),
            "market": account.get("market"),
            "base_currency": account.get("base_currency"),
            "total_equity": account.get("total_equity"),
            "total_market_value": account.get("total_market_value"),
            "total_cash": account.get("total_cash"),
            "realized_pnl": account.get("realized_pnl"),
            "unrealized_pnl": account.get("unrealized_pnl"),
            "fx_stale": account.get("fx_stale"),
        }
        if include_positions:
            account_payload["positions"] = positions
        else:
            account_payload["position_count"] = len(positions)
            account_payload["top_positions"] = positions[:top_n]
        compact_accounts.append(account_payload)

    return {
        "as_of": snapshot.get("as_of"),
        "cost_method": snapshot.get("cost_method"),
        "currency": snapshot.get("currency"),
        "account_count": snapshot.get("account_count"),
        "total_cash": snapshot.get("total_cash"),
        "total_market_value": snapshot.get("total_market_value"),
        "total_equity": snapshot.get("total_equity"),
        "realized_pnl": snapshot.get("realized_pnl"),
        "unrealized_pnl": snapshot.get("unrealized_pnl"),
        "fx_stale": snapshot.get("fx_stale"),
        "accounts": compact_accounts,
    }


def _compact_portfolio_risk(risk: dict, top_n: int = 10) -> dict:
    """Shrink portfolio risk payload for tool responses."""
    if not isinstance(risk, dict):
        return {}
    concentration = risk.get("concentration", {}) or {}
    top_positions = list(concentration.get("top_positions") or [])
    top_positions = sorted(
        top_positions,
        key=lambda item: float((item or {}).get("weight_pct") or 0.0),
        reverse=True,
    )[:top_n]
    stop_loss = risk.get("stop_loss", {}) or {}
    stop_items = list(stop_loss.get("items") or [])
    stop_items = sorted(
        stop_items,
        key=lambda item: float((item or {}).get("loss_pct") or 0.0),
        reverse=True,
    )[:top_n]
    drawdown = risk.get("drawdown", {}) or {}
    return {
        "as_of": risk.get("as_of"),
        "currency": risk.get("currency"),
        "cost_method": risk.get("cost_method"),
        "thresholds": risk.get("thresholds", {}),
        "concentration": {
            "alert": concentration.get("alert", False),
            "top_weight_pct": concentration.get("top_weight_pct"),
            "top_positions": top_positions,
        },
        "drawdown": {
            "alert": drawdown.get("alert", False),
            "max_drawdown_pct": drawdown.get("max_drawdown_pct"),
            "current_drawdown_pct": drawdown.get("current_drawdown_pct"),
            "fx_stale": drawdown.get("fx_stale", False),
        },
        "stop_loss": {
            "near_alert": stop_loss.get("near_alert", False),
            "triggered_count": stop_loss.get("triggered_count", 0),
            "near_count": stop_loss.get("near_count", 0),
            "items": stop_items,
        },
    }


# ============================================================
# get_realtime_quote
# ============================================================

def _handle_get_realtime_quote(stock_code: str) -> dict:
    """Get real-time stock quote."""
    manager = _get_fetcher_manager()
    quote = manager.get_realtime_quote(stock_code)
    if quote is None:
        return {
            "error": f"No realtime quote available for {stock_code}",
            "retriable": False,
            "note": "All data sources unavailable (network or circuit-breaker). Skip this tool and proceed with historical data only.",
        }

    return {
        "code": quote.code,
        "name": quote.name,
        "price": quote.price,
        "change_pct": quote.change_pct,
        "change_amount": quote.change_amount,
        "volume": quote.volume,
        "amount": quote.amount,
        "volume_ratio": quote.volume_ratio,
        "turnover_rate": quote.turnover_rate,
        "amplitude": quote.amplitude,
        "open": quote.open_price,
        "high": quote.high,
        "low": quote.low,
        "pre_close": quote.pre_close,
        "pe_ratio": quote.pe_ratio,
        "pb_ratio": quote.pb_ratio,
        "total_mv": quote.total_mv,
        "circ_mv": quote.circ_mv,
        "change_60d": quote.change_60d,
        "source": quote.source.value if hasattr(quote.source, 'value') else str(quote.source),
    }


get_realtime_quote_tool = ToolDefinition(
    name="get_realtime_quote",
    description="Get real-time stock quote including price, change%, volume ratio, "
                "turnover rate, PE, PB, market cap. Returns live market data.",
    parameters=[
        ToolParameter(
            name="stock_code",
            type="string",
            description="Stock code, e.g., '600519' (A-share), 'AAPL' (US), 'hk00700' (HK)",
        ),
    ],
    handler=_handle_get_realtime_quote,
    category="data",
)


# ============================================================
# get_daily_history
# ============================================================

def _handle_get_daily_history(stock_code: str, days: int = 60) -> dict:
    """Get daily OHLCV history data."""
    effective_days, metadata = _normalize_history_days(days)

    from src.services.history_loader import load_history_df
    df, source = load_history_df(stock_code, days=effective_days)

    if df is None or df.empty:
        return _append_history_metadata(
            {"error": f"No historical data available for {stock_code}"},
            metadata,
        )

    if source != "db_cache":
        _, normalized_code = _history_code_candidates(stock_code)
        try:
            saved_count = _get_db().save_daily_data(df, normalized_code, source)
            logger.info(
                "Agent daily history persisted for %s (source=%s, new_records=%s)",
                normalized_code,
                source,
                saved_count,
            )
        except Exception as exc:
            logger.warning(
                "Agent daily history persistence failed for %s: %s",
                normalized_code,
                exc,
            )

    # Convert DataFrame to list of dicts (last N records)
    records = df.tail(min(effective_days, len(df))).to_dict(orient="records")
    # Ensure date is string
    for r in records:
        if "date" in r:
            r["date"] = str(r["date"])

    response_code = stock_code
    if source == "db_cache" and records:
        response_code = records[-1].get("code") or response_code

    return _append_history_metadata({
        "code": response_code,
        "source": source,
        "cache_hit": source == "db_cache",
        "requested_days": effective_days,
        "effective_days": effective_days,
        "actual_records": len(records),
        "partial_cache": source == "db_cache" and len(records) < effective_days,
        "total_records": len(records),
        "data": records,
    }, metadata)


get_daily_history_tool = ToolDefinition(
    name="get_daily_history",
    description="Get daily OHLCV (open, high, low, close, volume) historical data "
                "with MA5/MA10/MA20 indicators. Returns the last N trading days.",
    parameters=[
        ToolParameter(
            name="stock_code",
            type="string",
            description="Stock code, e.g., '600519' (A-share), 'AAPL' (US)",
        ),
        ToolParameter(
            name="days",
            type="integer",
            description="Number of trading days to fetch (default: 60)",
            required=False,
            default=60,
        ),
    ],
    handler=_handle_get_daily_history,
    category="data",
)


# ============================================================
# get_chip_distribution
# ============================================================

def _handle_get_chip_distribution(stock_code: str) -> dict:
    """Get chip distribution data."""
    manager = _get_fetcher_manager()
    chip = manager.get_chip_distribution(stock_code)

    if chip is None:
        return {"error": f"No chip distribution data available for {stock_code}"}

    return {
        "code": chip.code,
        "date": chip.date,
        "source": chip.source,
        "profit_ratio": chip.profit_ratio,
        "avg_cost": chip.avg_cost,
        "cost_90_low": chip.cost_90_low,
        "cost_90_high": chip.cost_90_high,
        "concentration_90": chip.concentration_90,
        "cost_70_low": chip.cost_70_low,
        "cost_70_high": chip.cost_70_high,
        "concentration_70": chip.concentration_70,
    }


get_chip_distribution_tool = ToolDefinition(
    name="get_chip_distribution",
    description="Get chip distribution analysis for a stock. Returns profit ratio, "
                "average cost, chip concentration at 90% and 70% levels. "
                "Useful for judging support/resistance and holding structure.",
    parameters=[
        ToolParameter(
            name="stock_code",
            type="string",
            description="A-share stock code, e.g., '600519'",
        ),
    ],
    handler=_handle_get_chip_distribution,
    category="data",
)


# ============================================================
# get_analysis_context
# ============================================================

def _handle_get_analysis_context(stock_code: str) -> dict:
    """Get stored analysis context from database."""
    db = _get_db()
    context = db.get_analysis_context(stock_code)

    if context is None:
        return {"error": f"No analysis context in DB for {stock_code}"}

    # Return safely serializable version (remove raw_data to save tokens)
    safe_context = {}
    for k, v in context.items():
        if k == "raw_data":
            safe_context["has_raw_data"] = True
            safe_context["raw_data_count"] = len(v) if isinstance(v, list) else 0
        else:
            safe_context[k] = v

    return safe_context


get_analysis_context_tool = ToolDefinition(
    name="get_analysis_context",
    description="Get historical analysis context from the database for a stock. "
                "Returns today's and yesterday's OHLCV data, MA alignment status, "
                "volume and price changes. Provides the technical data foundation.",
    parameters=[
        ToolParameter(
            name="stock_code",
            type="string",
            description="Stock code, e.g., '600519'",
        ),
    ],
    handler=_handle_get_analysis_context,
    category="data",
)


# ============================================================
# get_stock_info
# ============================================================

def _handle_get_stock_info(stock_code: str) -> dict:
    """Get stock fundamental information through unified fundamental context."""
    manager = _get_fetcher_manager()
    try:
        fundamental_context = manager.get_fundamental_context(stock_code)
    except Exception as e:
        logger.warning(f"get_stock_info via fundamental pipeline failed for {stock_code}: {e}")
        fundamental_context = manager.build_failed_fundamental_context(stock_code, str(e))

    compact_context = _compact_fundamental_context(fundamental_context)
    enrich_warnings: List[str] = []
    enrich_sources: List[Dict[str, Any]] = []
    compact_context, enrich_warnings, enrich_sources = _enrich_agent_native_fundamentals(stock_code, compact_context)
    valuation = compact_context.get("valuation", {}).get("data", {})
    sector_rankings = compact_context.get("boards", {}).get("data", {})
    belong_boards = manager.get_belong_boards(stock_code)

    stock_name = stock_code.upper()
    try:
        stock_name = manager.get_stock_name(stock_code) or stock_name
    except Exception:
        pass

    return {
        "code": stock_code.upper(),
        "name": stock_name,
        "pe_ratio": valuation.get("pe_ratio"),
        "pb_ratio": valuation.get("pb_ratio"),
        "total_mv": valuation.get("total_mv"),
        "circ_mv": valuation.get("circ_mv"),
        "fundamental_context": compact_context,
        "warnings": enrich_warnings,
        "source_chain": enrich_sources,
        "belong_boards": belong_boards,
        # Compatibility alias for existing callers; prefer belong_boards.
        # Planned for future deprecation in a major version.
        "boards": belong_boards,
        "sector_rankings": sector_rankings,
    }


get_stock_info_tool = ToolDefinition(
    name="get_stock_info",
    description="Get stock fundamental information: valuation, growth, earnings, institution flow, "
                "stock sector membership (belong_boards; boards is compatibility alias) and "
                "sector rankings. Returns a compact fundamental_context to reduce token usage.",
    parameters=[
        ToolParameter(
            name="stock_code",
            type="string",
            description="A-share stock code, e.g., '600519'",
        ),
    ],
    handler=_handle_get_stock_info,
    category="data",
)


# ============================================================
# get_portfolio_snapshot
# ============================================================

def _handle_get_portfolio_snapshot(
    account_id: Optional[int] = None,
    cost_method: str = "fifo",
    include_positions: bool = False,
    include_risk: bool = True,
    as_of: Optional[str] = None,
) -> dict:
    """Get compact portfolio snapshot for account-aware suggestions."""
    method = (cost_method or "fifo").strip().lower()
    if method not in {"fifo", "avg"}:
        return {"error": "cost_method must be fifo or avg"}

    as_of_date = None
    if as_of:
        try:
            as_of_date = date.fromisoformat(str(as_of).strip())
        except ValueError:
            return {"error": "as_of must be YYYY-MM-DD"}

    try:
        from src.services.portfolio_service import PortfolioService
        from src.services.portfolio_risk_service import PortfolioRiskService
    except Exception as exc:
        logger.warning("get_portfolio_snapshot unavailable: %s", exc)
        return {"status": "not_supported", "error": f"portfolio module unavailable: {exc}"}

    try:
        portfolio_service = PortfolioService()
        snapshot = portfolio_service.get_portfolio_snapshot(
            account_id=account_id,
            as_of=as_of_date,
            cost_method=method,
        )
        result = {
            "status": "ok",
            "snapshot": _compact_portfolio_snapshot(snapshot, include_positions=bool(include_positions)),
        }
        if include_risk:
            try:
                risk_service = PortfolioRiskService(portfolio_service=portfolio_service)
                risk = risk_service.get_risk_report(
                    account_id=account_id,
                    as_of=as_of_date,
                    cost_method=method,
                )
                result["risk"] = {"status": "ok", **_compact_portfolio_risk(risk)}
            except Exception as risk_exc:
                logger.warning("get_portfolio_snapshot risk block failed: %s", risk_exc)
                result["risk"] = {"status": "failed", "error": str(risk_exc)}
        return result
    except Exception as exc:
        logger.warning("get_portfolio_snapshot failed: %s", exc)
        return {"status": "failed", "error": f"failed to fetch portfolio snapshot: {exc}"}


get_portfolio_snapshot_tool = ToolDefinition(
    name="get_portfolio_snapshot",
    description="Get portfolio snapshot summary and optional risk blocks. "
                "Default returns compact summary for lower token usage; "
                "set include_positions=true to include full position details.",
    parameters=[
        ToolParameter(
            name="account_id",
            type="integer",
            description="Optional account id; omit to use all active accounts.",
            required=False,
            default=None,
        ),
        ToolParameter(
            name="cost_method",
            type="string",
            description="Cost method: fifo or avg (default: fifo).",
            required=False,
            default="fifo",
            enum=["fifo", "avg"],
        ),
        ToolParameter(
            name="include_positions",
            type="boolean",
            description="Whether to include full positions in snapshot output (default: false).",
            required=False,
            default=False,
        ),
        ToolParameter(
            name="include_risk",
            type="boolean",
            description="Whether to include risk summary block (default: true).",
            required=False,
            default=True,
        ),
        ToolParameter(
            name="as_of",
            type="string",
            description="Optional snapshot date in YYYY-MM-DD format (default: today).",
            required=False,
            default=None,
        ),
    ],
    handler=_handle_get_portfolio_snapshot,
    category="data",
)


# ============================================================
# get_dragon_tiger / get_board_context
# ============================================================

def _handle_get_dragon_tiger(stock_code: str, lookback_days: int = 20) -> dict:
    """Get dragon-tiger (龙虎榜) evidence for a stock via the existing fundamental adapter."""
    manager = _get_fetcher_manager()
    try:
        ctx = manager.get_dragon_tiger_context(stock_code)
    except Exception as exc:
        logger.warning("get_dragon_tiger failed for %s: %s", stock_code, exc)
        return {"stock_code": stock_code, "status": "failed", "error": str(exc)}
    result = {"stock_code": stock_code, "lookback_days": lookback_days}
    if isinstance(ctx, dict):
        if ctx.get("status") == "failed":
            fallback_ctx = _fallback_dragon_tiger_context(
                stock_code,
                lookback_days=lookback_days,
                prior_errors=list(ctx.get("errors", [])),
            )
            if fallback_ctx:
                ctx = fallback_ctx
        detail_payload = _fetch_dragon_tiger_details(stock_code, lookback_days=lookback_days)
        if detail_payload:
            ctx.setdefault("data", {})["details"] = detail_payload
            ctx.setdefault("source_chain", [])
            if isinstance(ctx["source_chain"], list):
                ctx["source_chain"].extend(detail_payload.get("source_chain", []))
            if detail_payload.get("errors"):
                ctx.setdefault("warnings", [])
                ctx["warnings"].append("dragon-tiger detail endpoints had partial failures; see data.details.errors.")
        result.update(ctx)
    else:
        result.update({"status": "failed", "error": "dragon_tiger context unavailable"})
    return result


get_dragon_tiger_tool = ToolDefinition(
    name="get_dragon_tiger",
    description="Get dragon-tiger list (龙虎榜) evidence for an A-share stock through the existing fundamental pipeline. Returns status, recent_count, latest_date and source_chain; does not infer investment conclusions.",
    parameters=[
        ToolParameter(
            name="stock_code",
            type="string",
            description="A-share stock code, e.g., '600519'",
        ),
        ToolParameter(
            name="lookback_days",
            type="integer",
            description="Lookback window in days for caller context (default: 20). The underlying adapter uses its configured source window.",
            required=False,
            default=20,
        ),
    ],
    handler=_handle_get_dragon_tiger,
    category="data",
)


def _handle_get_board_context(stock_code: str) -> dict:
    """Get board/sector membership and ranking evidence for a stock."""
    manager = _get_fetcher_manager()
    # Avoid the efinance belong-board endpoint on the agent-native path: its
    # wrapper times out in the caller but leaves a non-daemon worker thread that
    # can keep short-lived CLI processes alive. Use basic-info industry first.
    boards = _fallback_belong_boards(stock_code)
    boards_error = None
    boards_warning = "used basic-info industry fallback for board membership"
    if not boards:
        boards_warning = None
        try:
            boards = manager.get_belong_boards(stock_code)
        except Exception as exc:
            logger.warning("get_belong_boards failed for %s: %s", stock_code, exc)
            boards = []
            boards_error = str(exc)
        else:
            boards_error = None
    try:
        ctx = manager.get_board_context(stock_code)
    except Exception as exc:
        logger.warning("get_board_context failed for %s: %s", stock_code, exc)
        ctx = {"status": "failed", "data": {}, "errors": [str(exc)]}
    if isinstance(ctx, dict) and ctx.get("status") == "failed":
        fallback_ctx = _fallback_sector_rankings_context(prior_errors=list(ctx.get("errors", [])))
        if fallback_ctx:
            ctx = fallback_ctx
    result = {"stock_code": stock_code, "belong_boards": boards, "board_context": ctx}
    if boards_error:
        result["errors"] = [boards_error]
    if boards_warning:
        result["warnings"] = [boards_warning]
    return result


get_board_context_tool = ToolDefinition(
    name="get_board_context",
    description="Get stock board membership plus sector ranking context through existing data-source fallback paths.",
    parameters=[
        ToolParameter(
            name="stock_code",
            type="string",
            description="A-share stock code, e.g., '600519'",
        ),
    ],
    handler=_handle_get_board_context,
    category="data",
)


# ============================================================
# Export all data tools
# ============================================================

ALL_DATA_TOOLS = [
    get_realtime_quote_tool,
    get_daily_history_tool,
    get_chip_distribution_tool,
    get_analysis_context_tool,
    get_stock_info_tool,
    get_portfolio_snapshot_tool,
    get_dragon_tiger_tool,
    get_board_context_tool,
]


# ============================================================
# get_capital_flow
# ============================================================

def _handle_get_capital_flow(stock_code: str) -> dict:
    """Get main-force capital flow data for a stock."""
    manager = _get_fetcher_manager()
    try:
        ctx = manager.get_capital_flow_context(stock_code)
    except Exception as exc:
        logger.warning("get_capital_flow failed for %s: %s", stock_code, exc)
        return {
            "stock_code": stock_code,
            "status": "error",
            "error": f"capital flow fetch failed: {exc}",
        }

    if isinstance(ctx, dict) and ctx.get("status") == "failed":
        fallback_ctx = _fallback_stock_capital_flow_context(
            stock_code,
            prior_errors=list(ctx.get("errors", [])),
        )
        if fallback_ctx:
            ctx = fallback_ctx

    status = ctx.get("status", "not_supported")
    if status == "not_supported":
        return {
            "stock_code": stock_code,
            "status": "not_supported",
            "note": "Capital flow data is only available for A-share stocks (not ETFs/indices).",
        }

    data = ctx.get("data", {})
    stock_flow = data.get("stock_flow") or {}
    sector_rankings = data.get("sector_rankings") or {}
    errors = ctx.get("errors") or []

    return {
        "stock_code": stock_code,
        "status": status,
        "main_net_inflow": stock_flow.get("main_net_inflow"),
        "inflow_5d": stock_flow.get("inflow_5d"),
        "inflow_10d": stock_flow.get("inflow_10d"),
        "sector_rankings": {
            "top_inflow_sectors": sector_rankings.get("top", [])[:3],
            "top_outflow_sectors": sector_rankings.get("bottom", [])[:3],
        },
        "errors": errors,
        "warnings": ctx.get("warnings", []),
        "source_chain": ctx.get("source_chain", []),
    }


get_capital_flow_tool = ToolDefinition(
    name="get_capital_flow",
    description=(
        "Get main-force (主力) capital flow data for an A-share stock. "
        "Returns today's net inflow, 5-day and 10-day cumulative inflows, "
        "and top sector-level capital flow rankings. "
        "Only supported for A-share individual stocks (not ETFs, indices, HK, or US stocks)."
    ),
    parameters=[
        ToolParameter(
            name="stock_code",
            type="string",
            description="A-share stock code, e.g., '600519'",
        ),
    ],
    handler=_handle_get_capital_flow,
    category="data",
)


ALL_DATA_TOOLS.append(get_capital_flow_tool)
