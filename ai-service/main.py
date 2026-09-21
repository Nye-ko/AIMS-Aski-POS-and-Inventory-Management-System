from datetime import date, datetime, timezone
from typing import Annotated, List, Optional

from fastapi import FastAPI
from pydantic import AfterValidator, BaseModel, Field

from backtest import MAX_ORIGINS, run_backtest
from forecast_engine import ENGINE_NAME, ENGINE_VERSION, build_forecast

app = FastAPI(title="AMPC POS AI Forecasting Microservice")

ISO_DATE = r"^\d{4}-\d{2}-\d{2}$"


def _real_date(value: str) -> str:
    date.fromisoformat(value)  # ValueError for impossible dates such as 2026-13-45 -> 422
    return value


IsoDate = Annotated[str, Field(pattern=ISO_DATE), AfterValidator(_real_date)]


class ProductInput(BaseModel):
    id: int
    sku: str = Field(min_length=1)
    name: str
    category: Optional[str] = None
    stock: int = 0
    minStock: int = 0
    expiryDate: Optional[IsoDate] = None
    createdAt: Optional[IsoDate] = None
    leadTimeDays: int = Field(default=7, ge=1, le=90)   # supplier's days from order to arrival
    onOrder: int = Field(default=0, ge=0)               # units on pending purchase orders


class SaleInput(BaseModel):
    """Units and gross revenue (before discounts) for one product on one store-local day."""
    sku: str
    date: IsoDate
    quantity: int = Field(ge=0)
    revenue: float = Field(ge=0)


class DailyTotalInput(BaseModel):
    """Store-wide gross / discount / net for one store-local day, from the Transaction table."""
    date: IsoDate
    gross: float = Field(ge=0)
    discount: float = Field(ge=0)
    net: float = Field(ge=0)


class StockoutInput(BaseModel):
    """A store-local day on which the product was out of stock (its zero sales say nothing about demand)."""
    sku: str
    date: IsoDate


class ForecastRequest(BaseModel):
    asOf: IsoDate          # today in the store's time zone; history ends yesterday
    timezone: Optional[str] = None
    daysToForecast: int = Field(default=30, ge=1, le=365)
    historyDays: int = Field(default=180, ge=7, le=730)
    products: List[ProductInput]
    sales: List[SaleInput] = []
    dailyTotals: List[DailyTotalInput] = []
    stockouts: List[StockoutInput] = []


class BacktestRequest(ForecastRequest):
    maxOrigins: int = Field(default=MAX_ORIGINS, ge=1, le=120)


@app.get("/health")
def health_check():
    return {
        "status": "online",
        "service": "AI Forecasting Engine",
        "engine": ENGINE_NAME,
        "engineVersion": ENGINE_VERSION,
    }


@app.post("/api/v1/forecast")
def generate_forecast(payload: ForecastRequest):
    result = build_forecast(payload.model_dump(), source="ai-service")
    result["meta"]["generatedAt"] = datetime.now(timezone.utc).isoformat()
    return result


@app.post("/api/v1/backtest")
def backtest(payload: BacktestRequest):
    """Replays the forecast engine over past days and grades it against what actually sold."""
    data = payload.model_dump()
    result = run_backtest(data, max_origins=data["maxOrigins"])
    result["meta"]["generatedAt"] = datetime.now(timezone.utc).isoformat()
    return result
