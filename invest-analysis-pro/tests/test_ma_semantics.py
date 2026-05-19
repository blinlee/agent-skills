try:
    import litellm  # noqa: F401
except ModuleNotFoundError:
    from tests.litellm_stub import ensure_litellm_stub

    ensure_litellm_stub()

from src.agent.tools.analysis_tools import _describe_ma_order, _describe_price_vs_ma
from src.core.pipeline import StockAnalysisPipeline


def test_price_vs_ma_status_uses_price_position_language():
    assert _describe_price_vs_ma(3, 3) == "价格站上全部均线"
    assert _describe_price_vs_ma(0, 3) == "价格跌破全部均线"
    assert _describe_price_vs_ma(2, 3) == "价格位于2/3条均线上方"


def test_ma_order_status_uses_order_language():
    bullish = {
        "ma5": {"value": 11.0},
        "ma10": {"value": 10.0},
        "ma20": {"value": 9.0},
    }
    bearish = {
        "ma5": {"value": 9.0},
        "ma10": {"value": 10.0},
        "ma20": {"value": 11.0},
    }
    mixed = {
        "ma5": {"value": 10.0},
        "ma10": {"value": 9.0},
        "ma20": {"value": 9.5},
    }

    assert _describe_ma_order(bullish) == "均线多头顺排（MA5>MA10>MA20）"
    assert _describe_ma_order(bearish) == "均线空头顺排（MA5<MA10<MA20）"
    assert _describe_ma_order(mixed) == "均线未形成顺排"


def test_compute_ma_status_uses_precise_price_and_ma_wording():
    assert StockAnalysisPipeline._compute_ma_status(11, 10, 9.5, 9) == "价在线上且均线多头 📈"
    assert StockAnalysisPipeline._compute_ma_status(8, 9, 9.5, 10) == "价在线下且均线空头 📉"
    assert StockAnalysisPipeline._compute_ma_status(10, 10, 10, 10) == "价格与均线震荡整理 ↔️"
