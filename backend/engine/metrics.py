from __future__ import annotations

import math

import numpy as np
import pandas as pd


TRADING_DAYS = 252


def max_drawdown(values: pd.Series) -> float:
    if values.empty:
        return 0.0
    running_max = values.cummax()
    drawdown = values / running_max - 1
    return float(drawdown.min() * 100)


def cagr(final_value: float, total_invested: float, start: pd.Timestamp, end: pd.Timestamp) -> float:
    years = max((end - start).days / 365.25, 1 / 365.25)
    if total_invested <= 0 or final_value <= 0:
        return 0.0
    return float(((final_value / total_invested) ** (1 / years) - 1) * 100)


def sharpe_ratio(daily_returns: pd.Series) -> float:
    clean = daily_returns.replace([np.inf, -np.inf], np.nan).dropna()
    if clean.empty or math.isclose(float(clean.std()), 0.0):
        return 0.0
    return float((clean.mean() / clean.std()) * math.sqrt(TRADING_DAYS))


def sortino_ratio(daily_returns: pd.Series) -> float:
    clean = daily_returns.replace([np.inf, -np.inf], np.nan).dropna()
    downside = clean[clean < 0]
    if clean.empty or downside.empty or math.isclose(float(downside.std()), 0.0):
        return 0.0
    return float((clean.mean() / downside.std()) * math.sqrt(TRADING_DAYS))


def risk_metrics(
    equity_curve: pd.DataFrame,
    total_invested: float,
    start: pd.Timestamp,
    end: pd.Timestamp,
) -> dict[str, float]:
    values = equity_curve["portfolioValue"]
    final_value = float(values.iloc[-1]) if not values.empty else 0.0
    profit = final_value - total_invested
    returns = values.pct_change().fillna(0)

    total_return = 0.0
    if total_invested > 0:
        total_return = (profit / total_invested) * 100

    return {
        "finalPortfolioValue": final_value,
        "totalInvested": float(total_invested),
        "profit": profit,
        "totalReturnPct": float(total_return),
        "cagr": cagr(final_value, total_invested, start, end),
        "maxDrawdown": max_drawdown(values),
        "sharpeRatio": sharpe_ratio(returns),
        "sortinoRatio": sortino_ratio(returns),
    }
