import json
import os
import subprocess
import sys

import pytest

from src.agent import native_cli
from src.agent.tools.registry import ToolDefinition, ToolParameter, ToolRegistry


def _tool(name, handler, params=None, category="data"):
    return ToolDefinition(
        name=name,
        description=f"fake {name}",
        parameters=params or [ToolParameter(name="stock_code", type="string", description="stock code")],
        handler=handler,
        category=category,
    )


def _fake_registry():
    registry = ToolRegistry()
    registry.register(_tool("get_realtime_quote", lambda stock_code: {"code": stock_code, "price": 10, "source": "fixture"}))
    registry.register(_tool("get_daily_history", lambda stock_code, days=60: {"code": stock_code, "source": "fixture-cache", "data": [{"date": f"2026-01-0{i}", "close": i} for i in range(1, 6)]}, [ToolParameter("stock_code", "string", "stock code"), ToolParameter("days", "integer", "days", required=False, default=60)]))
    registry.register(_tool("analyze_trend", lambda stock_code: {"trend_status": "fixture"}))
    registry.register(_tool("calculate_ma", lambda stock_code, periods="5,10", days=120: {"ma": {"ma5": {"value": 10}}}, [ToolParameter("stock_code", "string", "stock code"), ToolParameter("periods", "string", "periods", required=False, default="5,10"), ToolParameter("days", "integer", "days", required=False, default=120)]))
    registry.register(_tool("get_volume_analysis", lambda stock_code, days=30: {"volume_status": "fixture"}, [ToolParameter("stock_code", "string", "stock code"), ToolParameter("days", "integer", "days", required=False, default=30)]))
    registry.register(_tool("analyze_pattern", lambda stock_code, days=60: {"patterns": []}, [ToolParameter("stock_code", "string", "stock code"), ToolParameter("days", "integer", "days", required=False, default=60)]))
    registry.register(_tool("get_chip_distribution", lambda stock_code: {"error": "fixture chip unavailable"}))
    registry.register(_tool("get_stock_info", lambda stock_code: {"code": stock_code, "name": "Fixture Corp", "source_chain": [{"provider": "fixture"}]}))
    registry.register(_tool("get_capital_flow", lambda stock_code: {"status": "not_supported", "note": "fixture unsupported"}))
    registry.register(_tool("get_board_context", lambda stock_code: {"belong_boards": []}))
    registry.register(_tool("get_dragon_tiger", lambda stock_code, lookback_days=20: {"status": "ok", "data": {"recent_count": 0}}, [ToolParameter("stock_code", "string", "stock code"), ToolParameter("lookback_days", "integer", "lookback", required=False, default=20)]))
    registry.register(_tool("search_stock_news", lambda stock_code, stock_name: {"success": True, "results": [{"title": "n1"}, {"title": "n2"}, {"title": "n3"}]}, [ToolParameter("stock_code", "string", "stock code"), ToolParameter("stock_name", "string", "stock name")], category="search"))
    registry.register(_tool("search_comprehensive_intel", lambda stock_code, stock_name: {"dimensions": {}}, [ToolParameter("stock_code", "string", "stock code"), ToolParameter("stock_name", "string", "stock name")], category="search"))
    registry.register(_tool("get_stock_backtest_summary", lambda stock_code, eval_window_days=30, limit=10: {"summary": None, "recent_evaluations": []}, [ToolParameter("stock_code", "string", "stock code"), ToolParameter("eval_window_days", "integer", "window", required=False, default=30), ToolParameter("limit", "integer", "limit", required=False, default=10)]))
    registry.register(_tool("get_strategy_backtest_summary", lambda eval_window_days=30: {"info": "none"}, [ToolParameter("eval_window_days", "integer", "window", required=False, default=30)]))
    registry.register(_tool("get_skill_backtest_summary", lambda skill_id, eval_window_days=30: {"skill_id": skill_id, "supported": False}, [ToolParameter("skill_id", "string", "skill"), ToolParameter("eval_window_days", "integer", "window", required=False, default=30)]))
    registry.register(_tool("get_portfolio_snapshot", lambda account_id=None, cost_method="fifo", include_positions=False, include_risk=True, as_of=None: {"status": "ok", "snapshot": {"account_count": 0}, "risk": {"status": "ok"}}, [ToolParameter("account_id", "integer", "account", required=False, default=None), ToolParameter("cost_method", "string", "cost", required=False, default="fifo"), ToolParameter("include_positions", "boolean", "positions", required=False, default=False), ToolParameter("include_risk", "boolean", "risk", required=False, default=True), ToolParameter("as_of", "string", "date", required=False, default=None)]))
    return registry


def _run_cli(monkeypatch, argv):
    monkeypatch.setattr(native_cli, "build_tool_registry", _fake_registry)
    parser = native_cli.build_parser()
    args = parser.parse_args(argv)
    return native_cli.run_command(args)


def test_main_invest_analysis_pro_help_exposes_agent_native_commands():
    result = subprocess.run(
        [sys.executable, "main.py", "invest-analysis-pro", "--help"],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0
    assert "invest-analysis-pro: agent-native investment research data CLI" in result.stdout
    for command in ["quote", "history", "technical", "bundle", "strategies"]:
        assert command in result.stdout


def test_tools_list_returns_standard_envelope(monkeypatch):
    envelope = _run_cli(monkeypatch, ["tools", "list", "--limit", "3"])
    assert tuple(envelope.keys()) == native_cli.ENVELOPE_KEYS
    assert envelope["status"] == "ok"
    assert envelope["task"] == "tools.list"
    assert envelope["data"]["count"] >= 1
    assert len(envelope["data"]["tools"]) == 3
    assert envelope["warnings"]


def test_strategies_list_reads_existing_yaml_without_network():
    parser = native_cli.build_parser()
    args = parser.parse_args(["strategies", "list", "--limit", "50"])
    envelope = native_cli.run_command(args, registry=_fake_registry())
    assert envelope["status"] == "ok"
    assert envelope["data"]["count"] >= 1
    assert all(item["id"] for item in envelope["data"]["strategies"])


def test_single_tool_run_and_no_llm_key_required(monkeypatch):
    for key in ["OPENAI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "LITELLM_MODEL"]:
        monkeypatch.delenv(key, raising=False)
    envelope = _run_cli(monkeypatch, ["quote", "600519"])
    assert envelope["status"] == "ok"
    assert envelope["data"]["get_realtime_quote"]["code"] == "600519"
    assert envelope["source_chain"] == [{"source": "fixture"}]


def test_bundle_partial_failure_and_compact_limit(monkeypatch):
    envelope = _run_cli(monkeypatch, ["bundle", "600519", "--include", "quote,history,chip", "--limit", "2"])
    assert envelope["status"] == "partial"
    assert envelope["data"]["quote"]["price"] == 10
    assert len(envelope["data"]["history"]["data"]) == 2
    assert [row["date"] for row in envelope["data"]["history"]["data"]] == ["2026-01-04", "2026-01-05"]
    assert envelope["data"]["chip"]["error"] == "fixture chip unavailable"
    assert envelope["errors"]
    assert any("truncated" in str(w) for w in envelope["warnings"])


def test_compact_limit_keeps_head_for_non_time_series_lists():
    data = {"news": [{"title": "newest"}, {"title": "older"}, {"title": "oldest"}]}
    compact, warnings = native_cli.apply_limit(data, limit=2, full=False)
    assert [row["title"] for row in compact["news"]] == ["newest", "older"]
    assert warnings


def test_argument_error_is_json_envelope(capsys):
    rc = native_cli.main(["tools", "run", "get_realtime_quote", "--param", "badparam"])
    assert rc == 2
    out = json.loads(capsys.readouterr().out)
    assert out["status"] == "failed"
    assert out["task"] == "argument_error"
    assert out["errors"]


def test_command_help_for_representative_subcommands():
    for argv in (["quote", "--help"], ["bundle", "--help"], ["strategies", "list", "--help"]):
        result = subprocess.run(
            [sys.executable, "main.py", "invest-analysis-pro", *argv],
            text=True,
            capture_output=True,
            check=False,
        )
        assert result.returncode == 0
        assert "usage:" in result.stdout


def test_legacy_standalone_entrypoints_remain_visible_and_not_agent_routed():
    import main as legacy_main

    assert legacy_main._maybe_run_agent_native_cli(["--serve-only"]) is None
    result = subprocess.run(
        [sys.executable, "main.py", "--help"],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0
    for legacy_flag in ["--serve-only", "--serve", "--webui", "--schedule", "--market-review"]:
        assert legacy_flag in result.stdout


def test_external_agent_result_endpoint_receives_without_llm_runtime():
    import asyncio
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location(
        "agent_endpoint_direct",
        Path("api/v1/endpoints/agent.py"),
    )
    agent_endpoint = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(agent_endpoint)
    ExternalAgentResultRequest = agent_endpoint.ExternalAgentResultRequest
    receive_external_agent_result = agent_endpoint.receive_external_agent_result

    class FakeDb:
        def __init__(self):
            self.calls = []

        def save_analysis_history(self, **kwargs):
            self.calls.append(kwargs)
            return 1

    fake_db = FakeDb()
    request = ExternalAgentResultRequest(
        stock_code="600519",
        stock_name="贵州茅台",
        analysis_summary="外部 Agent 生成的摘要",
        report_markdown="# 外部 Agent 报告",
        evidence_envelope={"status": "ok", "task": "bundle"},
    )

    response = asyncio.run(receive_external_agent_result(request, db_manager=fake_db))

    assert response.success is True
    assert response.status == "received"
    assert response.saved_count == 1
    assert fake_db.calls[0]["report_type"] == "agent_native"
    result = fake_db.calls[0]["result"]
    assert result.raw_response["product"] == "invest-analysis-pro"
    assert result.raw_response["source"] == "external_agent"
    assert fake_db.calls[0]["context_snapshot"]["workflow"] == "agent_native"
