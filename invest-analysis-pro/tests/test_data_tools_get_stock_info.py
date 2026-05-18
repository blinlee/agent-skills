# -*- coding: utf-8 -*-
"""
Contract tests for get_stock_info tool output semantics.
"""

import os
import sys
import unittest
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.agent.tools.data_tools import (
    _extract_dividend_history_payload,
    _extract_financial_abstract_enrichment,
    _format_quick_report_summary,
    _handle_get_stock_info,
)


class _DummyManager:
    def __init__(self):
        self._context = {
            "market": "cn",
            "status": "partial",
            "coverage": {
                "valuation": "ok",
                "growth": "not_supported",
                "earnings": "not_supported",
                "institution": "not_supported",
                "capital_flow": "not_supported",
                "dragon_tiger": "not_supported",
                "boards": "ok",
            },
            "valuation": {
                "status": "ok",
                "data": {
                    "pe_ratio": 12.3,
                    "pb_ratio": 2.1,
                    "total_mv": 1.0e11,
                    "circ_mv": 7.0e10,
                },
            },
            "growth": {"status": "not_supported", "data": {}},
            "earnings": {"status": "not_supported", "data": {}},
            "institution": {"status": "not_supported", "data": {}},
            "capital_flow": {"status": "not_supported", "data": {}},
            "dragon_tiger": {"status": "not_supported", "data": {}},
            "boards": {
                "status": "ok",
                "data": {
                    "top": [{"name": "白酒", "change_pct": 2.3}],
                    "bottom": [{"name": "煤炭", "change_pct": -1.7}],
                },
            },
        }
        self._belong_boards = [{"name": "白酒"}, {"name": "消费"}]

    def get_fundamental_context(self, _stock_code: str):
        return self._context

    def build_failed_fundamental_context(self, _stock_code: str, _reason: str):
        return {}

    def get_belong_boards(self, _stock_code: str):
        return self._belong_boards

    def get_stock_name(self, _stock_code: str):
        return "贵州茅台"


class TestGetStockInfoContract(unittest.TestCase):
    def test_get_stock_info_preserves_board_semantics(self) -> None:
        manager = _DummyManager()
        with patch("src.agent.tools.data_tools._get_fetcher_manager", return_value=manager):
            result = _handle_get_stock_info("600519")

        self.assertEqual(result["name"], "贵州茅台")
        self.assertEqual(result["code"], "600519")
        self.assertEqual(result["pe_ratio"], 12.3)
        self.assertEqual(result["pb_ratio"], 2.1)

        # Contract: boards is compatibility alias of belong_boards.
        self.assertEqual(result["belong_boards"], manager._belong_boards)
        self.assertEqual(result["boards"], result["belong_boards"])

        # Contract: sector_rankings comes from fundamental_context.boards.data.
        self.assertEqual(result["sector_rankings"], manager._context["boards"]["data"])
        self.assertEqual(
            result["fundamental_context"]["boards"]["data"],
            result["sector_rankings"],
        )

    def test_transposed_financial_abstract_is_parsed_for_agent_native_enrichment(self) -> None:
        df = pd.DataFrame(
            [
                {"选项": "常用指标", "指标": "归母净利润", "20260331": 136.0, "20250331": 100.0},
                {"选项": "常用指标", "指标": "营业总收入", "20260331": 1760.0, "20250331": 1600.0},
                {"选项": "常用指标", "指标": "经营活动产生的现金流量净额", "20260331": 513.0, "20250331": 400.0},
                {"选项": "盈利能力", "指标": "净资产收益率", "20260331": 2.3, "20250331": 2.0},
                {"选项": "盈利能力", "指标": "销售毛利率", "20260331": 21.5, "20250331": 20.0},
            ]
        )

        result = _extract_financial_abstract_enrichment(df)

        self.assertEqual(result["growth"]["report_period"], "20260331")
        self.assertEqual(result["growth"]["revenue_yoy"], 10.0)
        self.assertEqual(result["growth"]["net_profit_yoy"], 36.0)
        self.assertEqual(result["growth"]["roe"], 2.3)
        self.assertEqual(result["growth"]["gross_margin"], 21.5)
        self.assertEqual(result["financial_report"]["report_date"], "2026-03-31")
        self.assertEqual(result["financial_report"]["revenue"], 1760.0)
        self.assertEqual(result["financial_report"]["net_profit_parent"], 136.0)
        self.assertEqual(result["financial_report"]["operating_cash_flow"], 513.0)

    def test_zero_dividend_history_is_explicit_evidence(self) -> None:
        df = pd.DataFrame(
            [
                {"公告日期": "2026-03-27", "派息": 0, "进度": "不分配"},
                {"公告日期": "2025-03-28", "派息": 0, "进度": "不分配"},
            ]
        )

        result = _extract_dividend_history_payload(df)

        self.assertEqual(result["status"], "no_cash_dividend")
        self.assertEqual(result["ttm_event_count"], 0)
        self.assertEqual(result["ttm_cash_dividend_per_share"], 0.0)
        self.assertEqual(result["coverage"], "queried_no_cash_dividend")

    def test_quick_report_summary_formats_metric_names(self) -> None:
        row = pd.Series(
            {
                "股票简称": "中芯国际",
                "公告日期": "2026-02-10",
                "营业收入-营业收入": 1000.0,
                "营业收入-同比增长": 16.48,
                "净利润-净利润": 120.0,
                "净利润-同比增长": 8.5,
                "净资产收益率": 1.2,
            }
        )

        summary = _format_quick_report_summary(row)

        self.assertIn("中芯国际", summary)
        self.assertIn("营收同比 16.48%", summary)
        self.assertIn("净利润同比 8.5%", summary)


if __name__ == "__main__":
    unittest.main()
