from __future__ import annotations

import json
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator

from engine.simulation import AssetInput, PortfolioAsset, StrategyConfig, parse_market_data, run_portfolio_simulation


app = FastAPI(title="Portfolio DCA Backtester", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Allocation(BaseModel):
    asset: str = Field(min_length=1)
    weight: float = Field(gt=0)


class UploadedAsset(BaseModel):
    fileName: str = Field(min_length=1)
    label: str = Field(min_length=1)


class Scenario(BaseModel):
    name: str = Field(min_length=1)
    allocations: list[Allocation] = Field(min_length=1)

    @field_validator("allocations")
    @classmethod
    def weights_must_equal_100(cls, allocations: list[Allocation]) -> list[Allocation]:
        total = sum(item.weight for item in allocations)
        if abs(total - 100) > 0.01:
            raise ValueError("Scenario weights must total 100%.")

        assets = [item.asset.strip().upper() for item in allocations]
        duplicates = sorted({asset for asset in assets if assets.count(asset) > 1})
        if duplicates:
            raise ValueError(f"Scenario contains duplicate assets: {', '.join(duplicates)}.")
        return allocations


class StrategyRequest(BaseModel):
    monthlyContribution: float = Field(gt=0)
    annualContributionIncreasePct: float = Field(ge=0)
    dcaDay: int = Field(ge=1, le=31)
    reinvestDividends: bool
    startDate: str
    endDate: str


class SimulationRequest(BaseModel):
    assets: list[UploadedAsset] = Field(min_length=1)
    scenarios: list[Scenario] = Field(min_length=1)
    strategy: StrategyRequest

    @model_validator(mode="after")
    def validate_labels_and_scenarios(self) -> "SimulationRequest":
        labels = [asset.label.strip().upper() for asset in self.assets]
        duplicates = sorted({label for label in labels if labels.count(label) > 1})
        if duplicates:
            raise ValueError(f"Asset labels must be unique: {', '.join(duplicates)}.")

        label_set = set(labels)
        missing = sorted(
            {
                allocation.asset.strip().upper()
                for scenario in self.scenarios
                for allocation in scenario.allocations
                if allocation.asset.strip().upper() not in label_set
            }
        )
        if missing:
            raise ValueError(f"Scenarios use labels that were not uploaded: {', '.join(missing)}.")

        scenario_names = [scenario.name.strip() for scenario in self.scenarios]
        empty_names = [name for name in scenario_names if not name]
        if empty_names:
            raise ValueError("Scenario names cannot be empty.")
        duplicate_scenarios = sorted({name for name in scenario_names if scenario_names.count(name) > 1})
        if duplicate_scenarios:
            raise ValueError(f"Scenario names must be unique: {', '.join(duplicate_scenarios)}.")
        return self


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/simulate")
async def simulate(
    config: Annotated[str, Form()],
    files: Annotated[list[UploadFile], File()],
):
    try:
        request = SimulationRequest.model_validate(json.loads(config))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid simulation config: {exc}") from exc

    uploads: dict[str, UploadFile] = {}
    file_names = [uploaded_file.filename for uploaded_file in files]
    duplicate_files = sorted({name for name in file_names if file_names.count(name) > 1})
    if duplicate_files:
        raise HTTPException(status_code=400, detail=f"Duplicate filenames are not allowed: {', '.join(duplicate_files)}")

    for uploaded_file in files:
        uploads[uploaded_file.filename] = uploaded_file

    missing_files = [asset.fileName for asset in request.assets if asset.fileName not in uploads]
    if missing_files:
        raise HTTPException(status_code=400, detail=f"Missing uploaded files: {', '.join(missing_files)}")

    assets = [
        AssetInput(
            symbol=item.label.strip().upper(),
            file_bytes=await uploads[item.fileName].read(),
            filename=uploads[item.fileName].filename,
        )
        for item in request.assets
    ]

    strategy = StrategyConfig(
        monthly_contribution=request.strategy.monthlyContribution,
        annual_contribution_increase_pct=request.strategy.annualContributionIncreasePct,
        dca_day=request.strategy.dcaDay,
        reinvest_dividends=request.strategy.reinvestDividends,
        start_date=request.strategy.startDate,
        end_date=request.strategy.endDate,
    )

    try:
        market_data = parse_market_data(assets)
        scenario_results = []
        growth_by_scenario = {}
        drawdown_by_scenario = {}
        contribution_by_scenario = {}

        for scenario in request.scenarios:
            portfolio_assets = [
                PortfolioAsset(symbol=allocation.asset.strip().upper(), weight=allocation.weight / 100)
                for allocation in scenario.allocations
            ]
            result = run_portfolio_simulation(market_data, portfolio_assets, strategy)
            scenario_name = scenario.name.strip()
            scenario_results.append({"name": scenario_name, "metrics": result["metrics"]})
            growth_by_scenario[scenario_name] = {
                row["date"]: row["portfolioValue"] for row in result["charts"]["growth"]
            }
            drawdown_by_scenario[scenario_name] = {
                row["date"]: row["portfolioDrawdown"] for row in result["charts"]["drawdown"]
            }
            contribution_by_scenario[scenario_name] = result["charts"]["contribution"]

        all_growth_dates = sorted({date for rows in growth_by_scenario.values() for date in rows})
        all_drawdown_dates = sorted({date for rows in drawdown_by_scenario.values() for date in rows})

        growth = [
            {"date": date, **{name: values.get(date) for name, values in growth_by_scenario.items()}}
            for date in all_growth_dates
        ]
        drawdown = [
            {"date": date, **{name: values.get(date) for name, values in drawdown_by_scenario.items()}}
            for date in all_drawdown_dates
        ]

        return {
            "scenarios": scenario_results,
            "charts": {
                "growth": growth,
                "drawdown": drawdown,
                "contribution": contribution_by_scenario,
            },
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
