from __future__ import annotations

import pandas as pd


def dividend_cash(shares: float, dividend_per_share: float) -> float:
    if shares <= 0 or dividend_per_share <= 0:
        return 0.0
    return shares * dividend_per_share


def dividend_events(data: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp) -> pd.Series:
    if "Dividends" not in data.columns:
        return pd.Series(dtype=float)

    dividends = data.loc[(data.index >= start) & (data.index <= end), "Dividends"].fillna(0.0)
    return dividends[dividends > 0]
