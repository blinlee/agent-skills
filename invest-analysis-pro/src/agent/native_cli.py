# -*- coding: utf-8 -*-
"""Agent-native CLI for invest-analysis-pro.

The CLI is a deterministic evidence generator: it executes existing data/tool
handlers and emits a stable JSON envelope for calling Agents. It does not call
LLMs, generate final investment conclusions, or require a REST service.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from src.agent.tools.registry import ToolDefinition, ToolRegistry

ENVELOPE_KEYS = (
    "status",
    "task",
    "input",
    "data",
    "coverage",
    "source_chain",
    "errors",
    "warnings",
    "generated_at",
)
PRODUCT_NAME = "invest-analysis-pro"


class CliArgumentError(ValueError):
    """Raised when CLI arguments are invalid and should be returned as JSON."""


class AgentNativeArgumentParser(argparse.ArgumentParser):
    """argparse parser that returns JSON-friendly errors instead of stderr exits."""

    def error(self, message: str) -> None:  # pragma: no cover - exercised via main
        raise CliArgumentError(message)


def generated_at() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def make_envelope(
    *,
    status: str,
    task: str,
    input: Optional[Mapping[str, Any]] = None,
    data: Any = None,
    coverage: Optional[Mapping[str, Any]] = None,
    source_chain: Optional[Iterable[Any]] = None,
    errors: Optional[Iterable[Any]] = None,
    warnings: Optional[Iterable[Any]] = None,
) -> Dict[str, Any]:
    return {
        "status": status,
        "task": task,
        "input": dict(input or {}),
        "data": {} if data is None else data,
        "coverage": dict(coverage or {}),
        "source_chain": list(source_chain or []),
        "errors": list(errors or []),
        "warnings": list(warnings or []),
        "generated_at": generated_at(),
    }


def _is_scalar(value: Any) -> bool:
    return value is None or isinstance(value, (str, int, bool)) or isinstance(value, float)


def to_jsonable(value: Any) -> Any:
    """Best-effort conversion of repo objects/DataFrames to JSON-serializable data."""
    if _is_scalar(value):
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return None
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(v) for v in value]
    if hasattr(value, "to_dict"):
        try:
            # pandas DataFrame/Series support orient for DataFrame only.
            return to_jsonable(value.to_dict(orient="records"))
        except TypeError:
            try:
                return to_jsonable(value.to_dict())
            except Exception:
                pass
        except Exception:
            pass
    if hasattr(value, "__dict__"):
        return to_jsonable(vars(value))
    return str(value)


def apply_limit(value: Any, *, limit: int, full: bool = False) -> Tuple[Any, List[str]]:
    """Recursively truncate large lists unless full output is requested."""
    warnings: List[str] = []
    if full:
        return to_jsonable(value), warnings

    def should_keep_tail(items: List[Any]) -> bool:
        """Return True for chronological time-series lists.

        Data modules such as history emit records oldest -> newest. Compact
        mode must preserve the latest bars, not the stale head of the window.
        Ranking/news lists intentionally keep their head because providers
        already order them by relevance or recency.
        """
        if not items or not all(isinstance(item, dict) for item in items):
            return False
        date_keys = {"date", "trade_date", "交易日期", "日期"}
        matched = 0
        for item in items:
            if any(key in item and item.get(key) not in (None, "") for key in date_keys):
                matched += 1
        return matched == len(items)

    def walk(obj: Any, path: str) -> Any:
        if isinstance(obj, list):
            if limit >= 0 and len(obj) > limit:
                warnings.append(f"{path or 'data'} truncated from {len(obj)} to {limit} items; use --full or higher --limit for more.")
                obj = obj[-limit:] if should_keep_tail(obj) and limit > 0 else obj[:limit]
            return [walk(item, f"{path}[]") for item in obj]
        if isinstance(obj, dict):
            return {k: walk(v, f"{path}.{k}" if path else str(k)) for k, v in obj.items()}
        return obj

    return walk(to_jsonable(value), "data"), warnings


def collect_source_chain(payload: Any) -> List[Any]:
    payload = to_jsonable(payload)
    chain: List[Any] = []

    def walk(obj: Any) -> None:
        if isinstance(obj, dict):
            if "source_chain" in obj and isinstance(obj["source_chain"], list):
                chain.extend(obj["source_chain"])
            elif "source" in obj and obj.get("source"):
                chain.append({"source": obj.get("source")})
            for value in obj.values():
                if isinstance(value, (dict, list)):
                    walk(value)
        elif isinstance(obj, list):
            for item in obj:
                if isinstance(item, (dict, list)):
                    walk(item)

    walk(payload)
    # stable de-duplication after JSON normalization
    seen = set()
    unique: List[Any] = []
    for item in chain:
        key = json.dumps(item, ensure_ascii=False, sort_keys=True, default=str)
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


def extract_errors_warnings(payload: Any) -> Tuple[List[Any], List[Any]]:
    payload = to_jsonable(payload)
    errors: List[Any] = []
    warnings: List[Any] = []

    def walk(obj: Any, path: str = "data") -> None:
        if isinstance(obj, dict):
            err = obj.get("error")
            if err:
                errors.append({"path": path, "message": err})
            errs = obj.get("errors")
            if isinstance(errs, list):
                errors.extend({"path": path, "message": e} for e in errs if e)
            warn = obj.get("warning")
            if warn:
                warnings.append({"path": path, "message": warn})
            warns = obj.get("warnings")
            if isinstance(warns, list):
                warnings.extend({"path": path, "message": w} for w in warns if w)
            info = obj.get("info")
            if info and not err:
                warnings.append({"path": path, "message": info})
            note = obj.get("note")
            if note:
                warnings.append({"path": path, "message": note})
            for key, value in obj.items():
                if isinstance(value, (dict, list)):
                    walk(value, f"{path}.{key}")
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                if isinstance(item, (dict, list)):
                    walk(item, f"{path}[{i}]")

    walk(payload)
    return errors, warnings


def status_from_parts(results: Mapping[str, Any], errors: Sequence[Any]) -> str:
    if not results and errors:
        return "failed"
    failed_keys = []
    ok_keys = []
    for key, payload in results.items():
        payload = to_jsonable(payload)
        if isinstance(payload, dict) and (payload.get("error") or payload.get("status") == "failed"):
            failed_keys.append(key)
        else:
            ok_keys.append(key)
    if failed_keys and ok_keys:
        return "partial"
    if failed_keys and not ok_keys:
        return "failed"
    if errors and ok_keys:
        return "partial"
    if errors and not ok_keys:
        return "failed"
    return "ok"


def build_tool_registry() -> ToolRegistry:
    from src.agent.tools.data_tools import ALL_DATA_TOOLS
    from src.agent.tools.analysis_tools import ALL_ANALYSIS_TOOLS
    from src.agent.tools.search_tools import ALL_SEARCH_TOOLS
    from src.agent.tools.market_tools import ALL_MARKET_TOOLS
    from src.agent.tools.backtest_tools import ALL_BACKTEST_TOOLS

    registry = ToolRegistry()
    for tool_def in ALL_DATA_TOOLS + ALL_ANALYSIS_TOOLS + ALL_SEARCH_TOOLS + ALL_MARKET_TOOLS + ALL_BACKTEST_TOOLS:
        registry.register(tool_def)
    return registry


def tool_schema(tool_def: ToolDefinition) -> Dict[str, Any]:
    return {
        "name": tool_def.name,
        "description": tool_def.description,
        "category": tool_def.category,
        "parameters": [
            {
                "name": p.name,
                "type": p.type,
                "description": p.description,
                "required": p.required,
                "enum": p.enum,
                "default": p.default,
            }
            for p in tool_def.parameters
        ],
    }


def _coerce_param(value: str, param_type: str) -> Any:
    if param_type == "integer":
        return int(value)
    if param_type == "number":
        return float(value)
    if param_type == "boolean":
        return str(value).strip().lower() in {"1", "true", "yes", "on"}
    if param_type in {"array", "object"}:
        return json.loads(value)
    return value


def execute_tool(registry: ToolRegistry, name: str, kwargs: Mapping[str, Any]) -> Any:
    tool_def = registry.get(name)
    if tool_def is None:
        raise CliArgumentError(f"Unknown tool: {name}")

    normalized = dict(kwargs)
    for param in tool_def.parameters:
        if param.name not in normalized or normalized[param.name] is None:
            if param.required:
                raise CliArgumentError(f"Missing required parameter for {name}: {param.name}")
            if param.default is not None:
                normalized[param.name] = param.default
            continue
        if isinstance(normalized[param.name], str) and param.type != "string":
            normalized[param.name] = _coerce_param(normalized[param.name], param.type)
    return registry.execute(name, **normalized)


def command_envelope(
    task: str,
    input_payload: Mapping[str, Any],
    data: Mapping[str, Any],
    *,
    limit: int,
    full: bool,
    extra_warnings: Optional[Iterable[Any]] = None,
) -> Dict[str, Any]:
    serial_data, limit_warnings = apply_limit(data, limit=limit, full=full)
    errors, warnings = extract_errors_warnings(serial_data)
    warnings.extend(limit_warnings)
    if extra_warnings:
        warnings.extend(extra_warnings)
    status = status_from_parts(serial_data if isinstance(serial_data, dict) else {task: serial_data}, errors)
    coverage = {
        "requested": list(data.keys()) if isinstance(data, dict) else [task],
        "ok": [k for k, v in (serial_data.items() if isinstance(serial_data, dict) else [(task, serial_data)]) if not (isinstance(v, dict) and (v.get("error") or v.get("status") == "failed"))],
        "failed": [k for k, v in (serial_data.items() if isinstance(serial_data, dict) else [(task, serial_data)]) if isinstance(v, dict) and (v.get("error") or v.get("status") == "failed")],
        "limit": None if full else limit,
        "mode": "full" if full else "compact",
    }
    return make_envelope(
        status=status,
        task=task,
        input=input_payload,
        data=serial_data,
        coverage=coverage,
        source_chain=collect_source_chain(serial_data),
        errors=errors,
        warnings=warnings,
    )


def _stock_name_or_code(registry: ToolRegistry, stock_code: str, provided_name: Optional[str]) -> str:
    if provided_name:
        return provided_name
    try:
        info = execute_tool(registry, "get_stock_info", {"stock_code": stock_code})
        if isinstance(info, dict) and info.get("name"):
            return str(info["name"])
    except Exception:
        pass
    return stock_code


def _strategy_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "strategies"


def list_strategies() -> List[Dict[str, Any]]:
    strategies = []
    for path in sorted(_strategy_dir().glob("*.yaml")):
        first_lines = path.read_text(encoding="utf-8").splitlines()[:40]
        title = path.stem
        description = ""
        for line in first_lines:
            stripped = line.strip()
            if stripped.startswith("name:"):
                title = stripped.split(":", 1)[1].strip().strip('"\'') or title
            elif stripped.startswith("description:"):
                description = stripped.split(":", 1)[1].strip().strip('"\'')
        strategies.append({"id": path.stem, "name": title, "description": description, "path": str(path.relative_to(Path.cwd())) if path.is_relative_to(Path.cwd()) else str(path)})
    return strategies


def read_strategy(strategy_id: str) -> Dict[str, Any]:
    safe_id = Path(strategy_id).stem
    path = _strategy_dir() / f"{safe_id}.yaml"
    if not path.exists():
        raise CliArgumentError(f"Unknown strategy: {strategy_id}")
    return {"id": safe_id, "path": str(path.relative_to(Path.cwd())) if path.is_relative_to(Path.cwd()) else str(path), "yaml": path.read_text(encoding="utf-8")}


def add_common_output_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--format", choices=["json"], default="json", help="Output format (json only for Agent consumption).")
    parser.add_argument("--compact", action="store_true", default=True, help="Emit compact output with list truncation (default).")
    parser.add_argument("--full", action="store_true", help="Emit full output without recursive list truncation.")
    parser.add_argument("--limit", type=int, default=20, help="Maximum list items per field in compact mode (default: 20).")


def build_parser() -> argparse.ArgumentParser:
    parser = AgentNativeArgumentParser(
        prog=PRODUCT_NAME,
        description=f"{PRODUCT_NAME}: agent-native investment research data CLI (deterministic JSON evidence, no LLM calls).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    tools = sub.add_parser("tools", help="List, inspect, or run reusable src.agent.tools definitions.")
    tools_sub = tools.add_subparsers(dest="tools_command", required=True)
    tools_list = tools_sub.add_parser("list", help="List available tool definitions.")
    tools_list.add_argument("--category", help="Optional tool category filter.")
    add_common_output_args(tools_list)
    tools_show = tools_sub.add_parser("show", help="Show one tool definition.")
    tools_show.add_argument("name")
    add_common_output_args(tools_show)
    tools_run = tools_sub.add_parser("run", help="Run one existing tool by name.")
    tools_run.add_argument("name")
    tools_run.add_argument("--param", action="append", default=[], help="Tool parameter as key=value; repeatable.")
    add_common_output_args(tools_run)

    strategies = sub.add_parser("strategies", help="List or read strategy YAML references.")
    strategies_sub = strategies.add_subparsers(dest="strategies_command", required=True)
    strategies_list = strategies_sub.add_parser("list", help="List strategies/*.yaml.")
    add_common_output_args(strategies_list)
    strategies_show = strategies_sub.add_parser("show", help="Read a strategy YAML file.")
    strategies_show.add_argument("strategy_id")
    add_common_output_args(strategies_show)

    def stock_cmd(name: str, help_text: str) -> argparse.ArgumentParser:
        p = sub.add_parser(name, help=help_text)
        p.add_argument("stock_code")
        add_common_output_args(p)
        return p

    stock_cmd("quote", "Realtime quote evidence.")
    h = stock_cmd("history", "Historical OHLCV evidence.")
    h.add_argument("--days", type=int, default=60)
    stock_cmd("technical", "Technical trend analysis evidence.")
    stock_cmd("trend", "Alias of technical.")
    ma = stock_cmd("ma", "Moving-average evidence.")
    ma.add_argument("--periods", default="5,10,20,30,60,120,250")
    ma.add_argument("--days", type=int, default=120)
    vol = stock_cmd("volume", "Volume-price evidence.")
    vol.add_argument("--days", type=int, default=30)
    pat = stock_cmd("pattern", "Local chart pattern evidence.")
    pat.add_argument("--days", type=int, default=60)
    local = stock_cmd("local-analysis", "Bundle deterministic local technical tools: trend, MA, volume, pattern.")
    local.add_argument("--days", type=int, default=60)
    stock_cmd("chip", "Chip distribution evidence.")
    stock_cmd("fundamentals", "Fundamental and stock info evidence.")
    stock_cmd("stock-info", "Alias of fundamentals.")
    stock_cmd("capital-flow", "Main-force capital flow evidence.")
    stock_cmd("boards", "Stock board membership and sector ranking evidence.")
    lhb = stock_cmd("lhb", "Dragon-tiger list evidence.")
    lhb.add_argument("--lookback-days", type=int, default=20)
    dt = stock_cmd("dragon-tiger", "Alias of lhb.")
    dt.add_argument("--lookback-days", type=int, default=20)

    market = sub.add_parser("market", help="Market indices/stats/hot/sector evidence.")
    market.add_argument("--region", choices=["cn", "hk", "us"], default="cn")
    market.add_argument("--top-n", type=int, default=10)
    market.add_argument("--include", default="indices,stats,sectors", help="Comma list: indices,stats,sectors,hot")
    add_common_output_args(market)

    sector = sub.add_parser("sector", help="Sector ranking evidence.")
    sector.add_argument("--top-n", type=int, default=10)
    add_common_output_args(sector)

    news = stock_cmd("news", "Latest news evidence; requires search provider keys if cache/provider unavailable.")
    news.add_argument("--stock-name")
    intel = stock_cmd("intel", "Comprehensive intelligence evidence; requires search provider keys if cache/provider unavailable.")
    intel.add_argument("--stock-name")

    backtest = sub.add_parser("backtest", help="Read-only backtest summaries.")
    backtest.add_argument("--stock-code")
    backtest.add_argument("--strategy-id")
    backtest.add_argument("--eval-window-days", type=int, default=30)
    backtest.add_argument("--items-limit", type=int, default=10, help="Recent evaluation item limit for stock backtest data (default: 10).")
    add_common_output_args(backtest)

    portfolio = sub.add_parser("portfolio", help="Portfolio snapshot evidence.")
    portfolio.add_argument("--account-id", type=int)
    portfolio.add_argument("--cost-method", choices=["fifo", "avg"], default="fifo")
    portfolio.add_argument("--include-positions", action="store_true")
    portfolio.add_argument("--no-risk", action="store_true")
    portfolio.add_argument("--as-of")
    add_common_output_args(portfolio)

    risk = sub.add_parser("risk", help="Portfolio risk evidence.")
    risk.add_argument("--account-id", type=int)
    risk.add_argument("--cost-method", choices=["fifo", "avg"], default="fifo")
    risk.add_argument("--as-of")
    add_common_output_args(risk)

    bundle = stock_cmd("bundle", "One-shot stock evidence context bundle.")
    bundle.add_argument("--days", type=int, default=60)
    bundle.add_argument("--stock-name")
    bundle.add_argument("--include", default="quote,history,technical,ma,volume,pattern,chip,fundamentals,capital-flow,boards,lhb", help="Comma list of modules to execute; add news/intel/backtest if needed.")
    return parser


def _params_from_key_values(items: Sequence[str]) -> Dict[str, str]:
    params: Dict[str, str] = {}
    for item in items:
        if "=" not in item:
            raise CliArgumentError(f"--param must be key=value, got: {item}")
        key, value = item.split("=", 1)
        key = key.strip()
        if not key:
            raise CliArgumentError("--param key cannot be empty")
        params[key] = value
    return params


def run_command(args: argparse.Namespace, registry: Optional[ToolRegistry] = None) -> Dict[str, Any]:
    registry = registry or build_tool_registry()
    limit = max(0, int(getattr(args, "limit", 20)))
    full = bool(getattr(args, "full", False))
    command = args.command

    if command == "tools":
        if args.tools_command == "list":
            tools = [tool_schema(t) for t in registry.list_tools(category=args.category)]
            return command_envelope("tools.list", {"category": args.category}, {"tools": tools, "count": len(tools)}, limit=limit, full=full)
        if args.tools_command == "show":
            tool_def = registry.get(args.name)
            if tool_def is None:
                raise CliArgumentError(f"Unknown tool: {args.name}")
            return command_envelope("tools.show", {"name": args.name}, {"tool": tool_schema(tool_def)}, limit=limit, full=full)
        params = _params_from_key_values(args.param)
        result = execute_tool(registry, args.name, params)
        return command_envelope("tools.run", {"name": args.name, "params": params}, {args.name: result}, limit=limit, full=full)

    if command == "strategies":
        if args.strategies_command == "list":
            strategies = list_strategies()
            return command_envelope("strategies.list", {}, {"strategies": strategies, "count": len(strategies)}, limit=limit, full=full)
        strategy = read_strategy(args.strategy_id)
        return command_envelope("strategies.show", {"strategy_id": args.strategy_id}, {"strategy": strategy}, limit=limit, full=full)

    simple_map: Dict[str, Tuple[str, Callable[[argparse.Namespace], Dict[str, Any]]]] = {
        "quote": ("get_realtime_quote", lambda a: {"stock_code": a.stock_code}),
        "history": ("get_daily_history", lambda a: {"stock_code": a.stock_code, "days": a.days}),
        "technical": ("analyze_trend", lambda a: {"stock_code": a.stock_code}),
        "trend": ("analyze_trend", lambda a: {"stock_code": a.stock_code}),
        "ma": ("calculate_ma", lambda a: {"stock_code": a.stock_code, "periods": a.periods, "days": a.days}),
        "volume": ("get_volume_analysis", lambda a: {"stock_code": a.stock_code, "days": a.days}),
        "pattern": ("analyze_pattern", lambda a: {"stock_code": a.stock_code, "days": a.days}),
        "chip": ("get_chip_distribution", lambda a: {"stock_code": a.stock_code}),
        "fundamentals": ("get_stock_info", lambda a: {"stock_code": a.stock_code}),
        "stock-info": ("get_stock_info", lambda a: {"stock_code": a.stock_code}),
        "capital-flow": ("get_capital_flow", lambda a: {"stock_code": a.stock_code}),
        "boards": ("get_board_context", lambda a: {"stock_code": a.stock_code}),
        "lhb": ("get_dragon_tiger", lambda a: {"stock_code": a.stock_code, "lookback_days": a.lookback_days}),
        "dragon-tiger": ("get_dragon_tiger", lambda a: {"stock_code": a.stock_code, "lookback_days": a.lookback_days}),
    }
    if command in simple_map:
        tool_name, build_kwargs = simple_map[command]
        kwargs = build_kwargs(args)
        result = execute_tool(registry, tool_name, kwargs)
        return command_envelope(command, kwargs, {tool_name: result}, limit=limit, full=full)

    if command == "local-analysis":
        modules = {
            "analyze_trend": {"stock_code": args.stock_code},
            "calculate_ma": {"stock_code": args.stock_code, "days": args.days},
            "get_volume_analysis": {"stock_code": args.stock_code, "days": args.days},
            "analyze_pattern": {"stock_code": args.stock_code, "days": args.days},
        }
        data: Dict[str, Any] = {}
        for name, kwargs in modules.items():
            try:
                data[name] = execute_tool(registry, name, kwargs)
            except Exception as exc:
                data[name] = {"status": "failed", "error": str(exc)}
        return command_envelope(command, {"stock_code": args.stock_code, "days": args.days}, data, limit=limit, full=full)

    if command == "market":
        include = {item.strip() for item in args.include.split(",") if item.strip()}
        tool_calls = []
        if "indices" in include:
            tool_calls.append(("get_market_indices", {"region": args.region}))
        if "stats" in include:
            tool_calls.append(("get_market_stats", {}))
        if "sectors" in include:
            tool_calls.append(("get_sector_rankings", {"top_n": args.top_n}))
        if "hot" in include:
            tool_calls.append(("get_hot_stocks", {"top_n": args.top_n}))
        data = {}
        for name, kwargs in tool_calls:
            try:
                data[name] = execute_tool(registry, name, kwargs)
            except Exception as exc:
                data[name] = {"status": "failed", "error": str(exc)}
        return command_envelope(command, {"region": args.region, "top_n": args.top_n, "include": sorted(include)}, data, limit=limit, full=full)

    if command == "sector":
        kwargs = {"top_n": args.top_n}
        result = execute_tool(registry, "get_sector_rankings", kwargs)
        return command_envelope(command, kwargs, {"get_sector_rankings": result}, limit=limit, full=full)

    if command in {"news", "intel"}:
        stock_name = _stock_name_or_code(registry, args.stock_code, getattr(args, "stock_name", None))
        tool_name = "search_stock_news" if command == "news" else "search_comprehensive_intel"
        kwargs = {"stock_code": args.stock_code, "stock_name": stock_name}
        result = execute_tool(registry, tool_name, kwargs)
        return command_envelope(command, kwargs, {tool_name: result}, limit=limit, full=full)

    if command == "backtest":
        if args.stock_code:
            tool_name = "get_stock_backtest_summary"
            kwargs = {"stock_code": args.stock_code, "eval_window_days": args.eval_window_days, "limit": args.items_limit}
        elif args.strategy_id:
            tool_name = "get_skill_backtest_summary"
            kwargs = {"skill_id": args.strategy_id, "eval_window_days": args.eval_window_days}
        else:
            tool_name = "get_strategy_backtest_summary"
            kwargs = {"eval_window_days": args.eval_window_days}
        result = execute_tool(registry, tool_name, kwargs)
        return command_envelope(command, kwargs, {tool_name: result}, limit=limit, full=full)

    if command in {"portfolio", "risk"}:
        kwargs = {
            "account_id": args.account_id,
            "cost_method": args.cost_method,
            "include_positions": getattr(args, "include_positions", False),
            "include_risk": True,
            "as_of": args.as_of,
        }
        if command == "portfolio":
            kwargs["include_risk"] = not args.no_risk
        result = execute_tool(registry, "get_portfolio_snapshot", kwargs)
        data = {"get_portfolio_snapshot": result}
        if command == "risk" and isinstance(result, dict):
            data = {"risk": result.get("risk", {"status": "failed", "error": "risk block missing"})}
        return command_envelope(command, kwargs, data, limit=limit, full=full)

    if command == "bundle":
        include = [item.strip() for item in args.include.split(",") if item.strip()]
        mapping = {
            "quote": ("get_realtime_quote", {"stock_code": args.stock_code}),
            "history": ("get_daily_history", {"stock_code": args.stock_code, "days": args.days}),
            "technical": ("analyze_trend", {"stock_code": args.stock_code}),
            "trend": ("analyze_trend", {"stock_code": args.stock_code}),
            "ma": ("calculate_ma", {"stock_code": args.stock_code, "days": max(args.days, 120)}),
            "volume": ("get_volume_analysis", {"stock_code": args.stock_code, "days": min(args.days, 60)}),
            "pattern": ("analyze_pattern", {"stock_code": args.stock_code, "days": args.days}),
            "chip": ("get_chip_distribution", {"stock_code": args.stock_code}),
            "fundamentals": ("get_stock_info", {"stock_code": args.stock_code}),
            "stock-info": ("get_stock_info", {"stock_code": args.stock_code}),
            "capital-flow": ("get_capital_flow", {"stock_code": args.stock_code}),
            "boards": ("get_board_context", {"stock_code": args.stock_code}),
            "lhb": ("get_dragon_tiger", {"stock_code": args.stock_code}),
            "dragon-tiger": ("get_dragon_tiger", {"stock_code": args.stock_code}),
            "backtest": ("get_stock_backtest_summary", {"stock_code": args.stock_code}),
        }
        data = {}
        stock_name = getattr(args, "stock_name", None)
        for module in include:
            if module in {"news", "intel"}:
                stock_name = _stock_name_or_code(registry, args.stock_code, stock_name)
                tool_name = "search_stock_news" if module == "news" else "search_comprehensive_intel"
                kwargs = {"stock_code": args.stock_code, "stock_name": stock_name}
            elif module in mapping:
                tool_name, kwargs = mapping[module]
            else:
                data[module] = {"status": "failed", "error": f"Unknown bundle module: {module}"}
                continue
            try:
                data[module] = execute_tool(registry, tool_name, kwargs)
            except Exception as exc:
                data[module] = {"status": "failed", "error": str(exc)}
        return command_envelope(command, {"stock_code": args.stock_code, "days": args.days, "include": include}, data, limit=limit, full=full)

    raise CliArgumentError(f"Unsupported command: {command}")


def print_json(envelope: Mapping[str, Any]) -> None:
    print(json.dumps(envelope, ensure_ascii=False, sort_keys=False, default=str))


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(list(argv) if argv is not None else None)
        envelope = run_command(args)
        print_json(envelope)
        return 0 if envelope.get("status") in {"ok", "partial"} else 1
    except CliArgumentError as exc:
        print_json(make_envelope(status="failed", task="argument_error", input={"argv": list(argv or sys.argv[1:])}, errors=[{"message": str(exc)}]))
        return 2
    except SystemExit as exc:  # argparse --help exits here; preserve behavior.
        return int(exc.code or 0)
    except Exception as exc:  # defensive: always return an Agent-consumable envelope.
        print_json(make_envelope(status="failed", task="internal_error", input={"argv": list(argv or sys.argv[1:])}, errors=[{"message": str(exc), "type": exc.__class__.__name__}]))
        return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
