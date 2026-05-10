from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

import numpy as np
import pandas as pd

from engine.dividend import dividend_cash
from engine.metrics import risk_metrics


@dataclass(frozen=True)
class AssetInput:
    symbol: str
    file_bytes: bytes
    filename: str


@dataclass(frozen=True)
class PortfolioAsset:
    symbol: str
    weight: float


@dataclass(frozen=True)
class StrategyConfig:
    monthly_contribution: float
    annual_contribution_increase_pct: float
    dca_day: int
    reinvest_dividends: bool
    start_date: str
    end_date: str


def _read_asset_file(asset: AssetInput) -> pd.DataFrame:
    suffix = asset.filename.rsplit(".", 1)[-1].lower()
    buffer = BytesIO(asset.file_bytes)
    if suffix == "xlsx":
        frame = pd.read_excel(buffer)
    elif suffix == "csv":
        frame = pd.read_csv(buffer)
    else:
        raise ValueError(f"{asset.symbol}: unsupported file format. Upload CSV or XLSX.")

    required = {"Date", "Close"}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"{asset.symbol}: missing required columns: {', '.join(sorted(missing))}.")

    frame = frame.copy()
    frame["Date"] = pd.to_datetime(frame["Date"], errors="coerce")
    frame["Close"] = pd.to_numeric(frame["Close"], errors="coerce")
    if "Dividends" in frame.columns:
        frame["Dividends"] = pd.to_numeric(frame["Dividends"], errors="coerce").fillna(0)
    else:
        frame["Dividends"] = 0.0

    frame = frame.dropna(subset=["Date", "Close"]).sort_values("Date")
    frame = frame.drop_duplicates(subset=["Date"], keep="last")
    frame = frame.set_index("Date")
    if frame.empty:
        raise ValueError(f"{asset.symbol}: no usable price rows found.")
    return frame[["Close", "Dividends"]]


def parse_market_data(assets: list[AssetInput]) -> dict[str, pd.DataFrame]:
    if not assets:
        raise ValueError("At least one uploaded asset is required.")

    labels = [asset.symbol for asset in assets]
    duplicates = sorted({label for label in labels if labels.count(label) > 1})
    if duplicates:
        raise ValueError(f"Duplicate asset labels are not allowed: {', '.join(duplicates)}.")

    return {asset.symbol: _read_asset_file(asset) for asset in assets}


def _next_trading_day(target: pd.Timestamp, trading_days: pd.DatetimeIndex) -> pd.Timestamp | None:
    position = trading_days.searchsorted(target)
    if position >= len(trading_days):
        return None
    return trading_days[position]


def _build_dca_events(strategy: StrategyConfig, trading_days: pd.DatetimeIndex) -> dict[pd.Timestamp, float]:
    start = pd.Timestamp(strategy.start_date)
    end = pd.Timestamp(strategy.end_date)
    first_month = pd.Timestamp(year=start.year, month=start.month, day=1)
    monthly_targets = pd.date_range(start=first_month, end=end, freq="MS")
    events: dict[pd.Timestamp, float] = {}

    for month_start in monthly_targets:
        year_index = max(month_start.year - start.year, 0)
        contribution = strategy.monthly_contribution * (
            (1 + strategy.annual_contribution_increase_pct / 100) ** year_index
        )
        max_day = month_start.days_in_month
        day = min(strategy.dca_day, max_day)
        requested_day = pd.Timestamp(year=month_start.year, month=month_start.month, day=day)
        if requested_day < start or requested_day > end:
            continue
        trade_day = _next_trading_day(requested_day, trading_days)
        if trade_day is not None and trade_day <= end:
            events[trade_day] = events.get(trade_day, 0.0) + float(contribution)

    return events


def _chart_rows(frame: pd.DataFrame) -> list[dict[str, float | str]]:
    rows: list[dict[str, float | str]] = []
    for timestamp, row in frame.iterrows():
        item: dict[str, float | str] = {"date": timestamp.strftime("%Y-%m-%d")}
        for column, value in row.items():
            item[column] = round(float(value), 4)
        rows.append(item)
    return rows


def run_portfolio_simulation(
    market_data: dict[str, pd.DataFrame],
    assets: list[PortfolioAsset],
    strategy: StrategyConfig,
) -> dict:
    if not assets:
        raise ValueError("At least one asset is required.")

    total_weight = sum(asset.weight for asset in assets)
    if abs(total_weight - 1) > 0.0001:
        raise ValueError("Portfolio weights must total 100%.")

    labels = [asset.symbol for asset in assets]
    duplicates = sorted({label for label in labels if labels.count(label) > 1})
    if duplicates:
        raise ValueError(f"Duplicate assets inside one scenario are not allowed: {', '.join(duplicates)}.")

    missing = [asset.symbol for asset in assets if asset.symbol not in market_data]
    if missing:
        raise ValueError(f"Scenario uses assets that were not uploaded: {', '.join(missing)}.")

    start = pd.Timestamp(strategy.start_date)
    end = pd.Timestamp(strategy.end_date)
    if start >= end:
        raise ValueError("Start date must be before end date.")

    common_days = None
    scenario_data = {asset.symbol: market_data[asset.symbol] for asset in assets}
    for frame in scenario_data.values():
        days = frame.loc[(frame.index >= start) & (frame.index <= end)].index
        common_days = days if common_days is None else common_days.intersection(days)

    if common_days is None or common_days.empty:
        raise ValueError("No overlapping trading dates found for the selected range.")

    common_days = common_days.sort_values()
    scenario_data = {symbol: frame.reindex(common_days).ffill() for symbol, frame in scenario_data.items()}
    dca_events = _build_dca_events(strategy, common_days)

    shares = {asset.symbol: 0.0 for asset in assets}
    weights = {asset.symbol: asset.weight for asset in assets}
    invested = 0.0
    pending_dividends = {asset.symbol: 0.0 for asset in assets}
    equity_rows = []
    asset_value_rows = []
    drawdown_rows = []
    invested_rows = []
    asset_peak = {asset.symbol: 0.0 for asset in assets}
    portfolio_peak = 0.0

    for day in common_days:
        contribution = dca_events.get(day, 0.0)
        if contribution > 0:
            invested += contribution
            for symbol, weight in weights.items():
                close = float(scenario_data[symbol].at[day, "Close"])
                shares[symbol] += (contribution * weight) / close

        for symbol in shares:
            dividend = float(scenario_data[symbol].at[day, "Dividends"])
            cash = dividend_cash(shares[symbol], dividend)
            if cash <= 0:
                continue
            if strategy.reinvest_dividends:
                close = float(scenario_data[symbol].at[day, "Close"])
                shares[symbol] += cash / close
            else:
                pending_dividends[symbol] += cash

        asset_values = {
            symbol: shares[symbol] * float(scenario_data[symbol].at[day, "Close"]) + pending_dividends[symbol]
            for symbol in shares
        }
        portfolio_value = sum(asset_values.values())
        portfolio_peak = max(portfolio_peak, portfolio_value)
        portfolio_drawdown = 0.0 if portfolio_peak == 0 else (portfolio_value / portfolio_peak - 1) * 100

        equity_rows.append(
            {
                "date": day,
                "portfolioValue": portfolio_value,
                "investedCapital": invested,
                "unrealizedGains": portfolio_value - invested,
            }
        )

        asset_row = {"date": day, **asset_values}
        asset_value_rows.append(asset_row)

        drawdown_row = {"date": day, "portfolioDrawdown": portfolio_drawdown}
        for symbol, value in asset_values.items():
            asset_peak[symbol] = max(asset_peak[symbol], value)
            drawdown_row[symbol] = 0.0 if asset_peak[symbol] == 0 else (value / asset_peak[symbol] - 1) * 100
        drawdown_rows.append(drawdown_row)

        invested_rows.append(
            {
                "date": day,
                "investedCapital": invested,
                "unrealizedGains": max(portfolio_value - invested, 0.0),
            }
        )

    equity = pd.DataFrame(equity_rows).set_index("date")
    metrics = risk_metrics(equity, invested, common_days[0], common_days[-1])

    benchmark = {}
    for symbol, frame in scenario_data.items():
        first = float(frame["Close"].iloc[0])
        normalized = frame["Close"] / first * strategy.monthly_contribution
        benchmark[symbol] = normalized.replace([np.inf, -np.inf], np.nan).fillna(0)

    benchmark_frame = pd.DataFrame(benchmark, index=common_days)
    growth_frame = equity[["portfolioValue"]].join(benchmark_frame)
    drawdown_frame = pd.DataFrame(drawdown_rows).set_index("date")
    contribution_frame = pd.DataFrame(invested_rows).set_index("date")

    return {
        "metrics": {key: round(value, 4) for key, value in metrics.items()},
        "charts": {
            "growth": _chart_rows(growth_frame),
            "drawdown": _chart_rows(drawdown_frame),
            "contribution": _chart_rows(contribution_frame),
        },
    }


def run_simulation(assets: list[AssetInput], strategy: StrategyConfig) -> dict:
    market_data = parse_market_data(assets)
    portfolio_assets = [PortfolioAsset(symbol=asset.symbol, weight=1 / len(assets)) for asset in assets]
    return run_portfolio_simulation(market_data, portfolio_assets, strategy)
