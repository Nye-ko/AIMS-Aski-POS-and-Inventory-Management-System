"""Regenerates tests/fixtures/forecast_input.json (deterministic, no randomness) and the golden
forecast_expected.json produced by the Python engine.

Run only when the engine's behaviour is changed on purpose:
    python tests/make_fixture.py
The Python regression test and the backend's JS parity test (backend/test/forecastEngine.test.js) both
compare against the golden file, so review its diff before committing.
"""
import json
import os
import sys
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from forecast_engine import build_forecast  # noqa: E402

AS_OF = date(2026, 9, 21)
FIRST_DAY = AS_OF - timedelta(days=45)

PRODUCTS = [
    {"id": 1, "sku": "STEADY-1", "name": "Steady Seller", "category": "Dairy", "stock": 40, "minStock": 10, "expiryDate": None, "createdAt": "2026-06-01"},
    {"id": 2, "sku": "SPARSE-1", "name": "Sparse Seller", "category": "Hardware", "stock": 30, "minStock": 5, "expiryDate": "2028-01-31", "createdAt": "2026-06-01"},
    {"id": 3, "sku": "NEW-1", "name": "New Product", "category": "Pantry", "stock": 4, "minStock": 5, "expiryDate": None, "createdAt": "2026-09-16"},
    {"id": 4, "sku": "DEAD-1", "name": "Never Sold", "category": "Pantry", "stock": 12, "minStock": 5, "expiryDate": None, "createdAt": "2026-06-01"},
    {"id": 5, "sku": "EXP-1", "name": "Expiring Soon", "category": "Dairy", "stock": 60, "minStock": 10, "expiryDate": "2026-10-05", "createdAt": "2026-06-01"},
    {"id": 6, "sku": "OLD-1", "name": "Already Expired", "category": None, "stock": 5, "minStock": 5, "expiryDate": "2026-09-01", "createdAt": "2026-06-01"},
]


def build_input():
    sales = []
    totals = []
    for i in range(46):
        d = FIRST_DAY + timedelta(days=i)
        iso = d.isoformat()
        day_rows = []
        day_rows.append(("STEADY-1", 2 + (i % 3), 50.0))
        if i % 5 == 0:
            day_rows.append(("SPARSE-1", 3, 120.25))
        if d >= date(2026, 9, 16):
            day_rows.append(("NEW-1", 1, 10.0))
        if d >= date(2026, 8, 25):
            day_rows.append(("EXP-1", 1, 33.33))
        gross = 0.0
        for sku, qty, price in day_rows:
            rev = round(qty * price, 2)
            sales.append({"sku": sku, "date": iso, "quantity": qty, "revenue": rev})
            gross += rev
        discount = round(gross * 0.10, 2) if i % 7 == 0 else 0.0
        totals.append({"date": iso, "gross": round(gross, 2), "discount": discount, "net": round(gross - discount, 2)})
    # today's partial day and an unknown product must both be ignored
    sales.append({"sku": "STEADY-1", "date": AS_OF.isoformat(), "quantity": 99, "revenue": 4950.0})
    sales.append({"sku": "GHOST", "date": (AS_OF - timedelta(days=3)).isoformat(), "quantity": 5, "revenue": 50.0})
    totals = [t for t in totals if t["date"] < AS_OF.isoformat()]
    return {
        "asOf": AS_OF.isoformat(),
        "timezone": "Asia/Manila",
        "daysToForecast": 30,
        "historyDays": 180,
        "products": PRODUCTS,
        "sales": sales,
        "dailyTotals": totals,
    }


if __name__ == "__main__":
    payload = build_input()
    out = os.path.join(HERE, "fixtures")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "forecast_input.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, indent=1)
        f.write("\n")
    with open(os.path.join(out, "forecast_expected.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(build_forecast(payload, source="ai-service"), f, indent=1)
        f.write("\n")
    print("fixtures written to", out)
