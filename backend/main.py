from __future__ import annotations

import json
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from engine.simulation import AssetInput, StrategyConfig, run_simulation


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


class SimulationRequest(BaseModel):
    allocations: list[Allocation] = Field(min_length=1)
    monthlyContribution: float = Field(gt=0)
    annualContributionIncreasePct: float = Field(ge=0)
    dcaDay: int = Field(ge=1, le=31)
    reinvestDividends: bool
    startDate: str
    endDate: str

    @field_validator("allocations")
    @classmethod
    def weights_must_equal_100(cls, allocations: list[Allocation]) -> list[Allocation]:
        total = sum(item.weight for item in allocations)
        if abs(total - 100) > 0.01:
            raise ValueError("Portfolio weights must total 100%.")
        return allocations


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

    uploads: dict[str, tuple[bytes, str]] = {}
    for uploaded_file in files:
        asset_name = uploaded_file.filename.rsplit(".", 1)[0].upper()
        uploads[asset_name] = (await uploaded_file.read(), uploaded_file.filename)

    missing_assets = [item.asset.upper() for item in request.allocations if item.asset.upper() not in uploads]
    if missing_assets:
        raise HTTPException(
            status_code=400,
            detail=f"Missing uploaded files for: {', '.join(missing_assets)}",
        )

    assets = [
        AssetInput(
            symbol=item.asset.upper(),
            weight=item.weight / 100,
            file_bytes=uploads[item.asset.upper()][0],
            filename=uploads[item.asset.upper()][1],
        )
        for item in request.allocations
    ]

    strategy = StrategyConfig(
        monthly_contribution=request.monthlyContribution,
        annual_contribution_increase_pct=request.annualContributionIncreasePct,
        dca_day=request.dcaDay,
        reinvest_dividends=request.reinvestDividends,
        start_date=request.startDate,
        end_date=request.endDate,
    )

    try:
        return run_simulation(assets, strategy)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
