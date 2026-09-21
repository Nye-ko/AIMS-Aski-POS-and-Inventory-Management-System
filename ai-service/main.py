from datetime import date, datetime, timezone
from typing import Annotated, List, Optional

from fastapi import FastAPI
from pydantic import AfterValidator, BaseModel, Field

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


class ForecastRequest(BaseModel):
    asOf: IsoDate          # today in the store's time zone; history ends yesterday
    timezone: Optional[str] = None
    daysToForecast: int = Field(default=30, ge=1, le=365)
    historyDays: int = Field(default=180, ge=7, le=730)
    products: List[ProductInput]
    sales: List[SaleInput] = []
    dailyTotals: List[DailyTotalInput] = []


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
