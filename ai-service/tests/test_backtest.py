"""Run from ai-service/:  python -m unittest discover -s tests -v"""
import os
import sys
import unittest
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from backtest import run_backtest, summarize  # noqa: E402

AS_OF = date(2026, 9, 21)


def product(sku="A", pid=1):
    return {"id": pid, "sku": sku, "name": sku, "category": "Cat", "stock": 50, "minStock": 0,
            "expiryDate": None, "createdAt": "2026-01-01"}


def build(qty_by_offset, days=45, sku="A", price=10.0):
    """qty_by_offset(i) = units sold i days before today (i = 1 is yesterday)."""
    sales, totals = [], []
    for i in range(1, days + 1):
        q = qty_by_offset(i)
        d = (AS_OF - timedelta(days=i)).isoformat()
        sales.append({"sku": sku, "date": d, "quantity": q, "revenue": q * price})
        totals.append({"date": d, "gross": q * price, "discount": 0, "net": q * price})
    return {"asOf": AS_OF.isoformat(), "products": [product(sku)], "sales": sales, "dailyTotals": totals}


class Metrics(unittest.TestCase):
    def test_wape_and_bias_are_computed_from_totals(self):
        s = summarize([(12, 10, 8)] * 5 + [(8, 10, 12)] * 5)   # errors +2 and -2 on 10 each
        self.assertEqual(s["model"]["wape"], 0.2)
        self.assertEqual(s["model"]["bias"], 0.0)               # over- and under-forecasts cancel
        self.assertEqual(s["model"]["mae"], 2.0)
        self.assertEqual(s["n"], 10)

    def test_verdict_better_when_clearly_beating_baseline(self):
        s = summarize([(10, 10, 20)] * 6)
        self.assertEqual(s["verdict"], "better")
        self.assertEqual(s["skill"], 1.0)

    def test_verdict_worse_similar_and_insufficient(self):
        self.assertEqual(summarize([(20, 10, 10)] * 6)["verdict"], "worse")
        self.assertEqual(summarize([(11, 10, 11)] * 6)["verdict"], "similar")
        self.assertEqual(summarize([(10, 10, 20)] * 4)["verdict"], "insufficient")   # too few samples
        self.assertEqual(summarize([])["verdict"], "insufficient")

    def test_nothing_sold_gives_no_wape_instead_of_dividing_by_zero(self):
        s = summarize([(1, 0, 1)] * 6)
        self.assertIsNone(s["model"]["wape"])
        self.assertEqual(s["verdict"], "insufficient")

    def test_perfect_model_and_perfect_baseline_are_similar(self):
        self.assertEqual(summarize([(5, 5, 5)] * 6)["verdict"], "similar")


class Backtest(unittest.TestCase):
    def test_constant_demand_is_forecast_exactly(self):
        r = run_backtest(build(lambda i: 2))
        self.assertEqual(r["units7"]["model"]["wape"], 0.0)
        self.assertEqual(r["units7"]["model"]["bias"], 0.0)
        self.assertEqual(r["revenue7"]["model"]["wape"], 0.0)
        self.assertGreater(r["meta"]["originsUsed"], 5)
        self.assertEqual(r["perSku"][0]["wape"], 0.0)

    def test_rising_demand_shows_under_forecast_bias(self):
        r = run_backtest(build(lambda i: 46 - i))      # ramps 1 -> 45 over the history
        self.assertLess(r["units7"]["model"]["bias"], 0)

    def test_no_history_returns_empty_valid_result(self):
        r = run_backtest({"asOf": AS_OF.isoformat(), "products": [product()], "sales": [], "dailyTotals": []})
        self.assertEqual(r["units7"]["verdict"], "insufficient")
        self.assertEqual(r["perSku"], [])
        self.assertEqual(r["meta"]["originsUsed"], 0)

    def test_short_history_is_insufficient(self):
        r = run_backtest(build(lambda i: 2, days=15))
        self.assertEqual(r["units7"]["verdict"], "insufficient")

    def test_revenue30_needs_long_history(self):
        self.assertEqual(run_backtest(build(lambda i: 2, days=45))["revenue30"]["n"], 0)
        self.assertGreater(run_backtest(build(lambda i: 2, days=120))["revenue30"]["n"], 0)

    def test_future_sales_never_leak_into_the_forecast(self):
        base = build(lambda i: 2)
        spiked = build(lambda i: 500 if i <= 6 else 2)     # the last 6 days are the "future" of the newest origin
        a = run_backtest(base, max_origins=1)
        b = run_backtest(spiked, max_origins=1)
        self.assertEqual(a["meta"]["lastOrigin"], b["meta"]["lastOrigin"])
        self.assertEqual(a["units7"]["forecastTotal"], b["units7"]["forecastTotal"])     # forecast unchanged
        self.assertNotEqual(a["units7"]["actualTotal"], b["units7"]["actualTotal"])      # the outcome did change

    def test_row_order_does_not_matter(self):
        p = build(lambda i: 1 + i % 4)
        q = {**p, "sales": list(reversed(p["sales"])), "dailyTotals": list(reversed(p["dailyTotals"]))}
        a, b = run_backtest(p), run_backtest(q)
        a["meta"].pop("generatedAt", None)
        self.assertEqual(a, b)

    def test_max_origins_caps_the_work(self):
        self.assertEqual(run_backtest(build(lambda i: 2, days=120), max_origins=10)["meta"]["originsUsed"], 10)

    def test_current_engine_is_compared_with_the_previous_version(self):
        # sales double 20 days ago: the 14-day revenue window catches up sooner than the old 28-day one
        r = run_backtest(build(lambda i: 4 if i <= 20 else 2, days=90))
        self.assertEqual(r["meta"]["engineVersion"], "2.0.0")
        self.assertEqual(r["meta"]["comparedWith"]["engineVersion"], "1.0.0")
        self.assertIsNotNone(r["revenue7"]["legacy"]["wape"])
        self.assertGreater(r["revenue7"]["skillVsLegacy"], 0)
        self.assertEqual(run_backtest(build(lambda i: 2), compare=False)["units7"].get("legacy"), None)

    def test_range_coverage_is_reported_and_is_a_share(self):
        r = run_backtest(build(lambda i: 2 + (i * 7) % 5, days=120))
        cover = r["units7"]["range"]
        self.assertEqual(cover["n"], r["units7"]["n"])
        self.assertTrue(0 <= cover["coverage"] <= 1)

    def test_stock_out_days_reported_in_the_payload_are_not_learned_from(self):
        payload = build(lambda i: 0 if i % 5 == 0 else 4, days=60)
        payload["stockouts"] = [{"sku": "A", "date": (AS_OF - timedelta(days=i)).isoformat()} for i in range(5, 61, 5)]
        aware = run_backtest(payload, compare=False)["units7"]
        payload["stockouts"] = []
        ignoring = run_backtest(payload, compare=False)["units7"]
        # a product that really sells 4 a day is forecast at 28 a week only when its empty days are skipped
        self.assertEqual(aware["forecastTotal"], 28.0 * aware["n"])
        self.assertLess(ignoring["forecastTotal"], aware["forecastTotal"])


if __name__ == "__main__":
    unittest.main()
