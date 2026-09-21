"""Run from ai-service/:  python -m unittest discover -s tests -v"""
import copy
import json
import os
import random
import sys
import unittest
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from forecast_engine import build_forecast  # noqa: E402

AS_OF = date(2026, 9, 21)


def load(name):
    with open(os.path.join(HERE, "fixtures", name), encoding="utf-8") as f:
        return json.load(f)


def product(sku="A", **kw):
    base = {"id": 1, "sku": sku, "name": sku, "category": "Cat", "stock": 0, "minStock": 0,
            "expiryDate": None, "createdAt": "2026-01-01"}
    base.update(kw)
    return base


def daily(sku, days, qty, price, start_offset=1):
    """qty units of sku on each of the `days` days ending yesterday."""
    return [
        {"sku": sku, "date": (AS_OF - timedelta(days=start_offset + i)).isoformat(), "quantity": qty, "revenue": qty * price}
        for i in range(days)
    ]


def totals(sales):
    by = {}
    for s in sales:
        by[s["date"]] = by.get(s["date"], 0) + s["revenue"]
    return [{"date": d, "gross": g, "discount": 0, "net": g} for d, g in by.items()]


def run(products, sales, days=30, **kw):
    payload = {"asOf": AS_OF.isoformat(), "daysToForecast": days, "products": products,
               "sales": sales, "dailyTotals": totals(sales)}
    payload.update(kw)
    return build_forecast(payload)


def item(result, sku):
    return next(i for i in result["skuDemandList"] if i["sku"] == sku)


class DemandRate(unittest.TestCase):
    def test_steady_seller_uses_exact_rate_not_rounded(self):
        r = run([product(stock=10)], daily("A", 28, 2, 50))
        a = item(r, "A")
        self.assertEqual(a["dailyDemand"], 2.0)
        self.assertEqual(a["forecast7Day"], 14.0)
        self.assertEqual(a["reorderQty"], 4)
        self.assertEqual(a["status"], "REORDER NOW")
        self.assertEqual(a["confidence"], "high")

    def test_slow_seller_is_not_floored_to_one_per_day(self):
        # 7 units on one day in a 28-day window = 0.25/day. The old service reported 1/day.
        r = run([product(stock=50)], daily("A", 1, 7, 10, start_offset=3) + daily("B", 27, 0, 1, start_offset=4))
        a = item(r, "A")
        self.assertEqual(a["dailyDemand"], 0.25)
        self.assertEqual(a["forecast7Day"], 1.8)
        self.assertEqual(a["status"], "HEALTHY")

    def test_days_without_sales_count_as_zero(self):
        # A sold 10 units on a single day; the store has 28 days of history -> 10/28, not 10/1.
        sales = daily("A", 1, 10, 5, start_offset=20) + daily("B", 28, 1, 1)
        r = run([product("A", stock=100), product("B", id=2, stock=100)], sales)
        self.assertEqual(item(r, "A")["dailyDemand"], round(10 / 28, 2))

    def test_new_product_is_not_diluted_by_days_before_it_existed(self):
        p = product("N", createdAt=(AS_OF - timedelta(days=5)).isoformat(), stock=100)
        base = daily("A", 28, 1, 10)
        r = run([product(stock=100), p], base + daily("N", 5, 1, 10))
        n = item(r, "N")
        self.assertEqual(n["dailyDemand"], 1.0)
        self.assertEqual(n["confidence"], "low")
        self.assertEqual(n["dataDays"], 5)

    def test_product_with_no_sales_is_still_listed(self):
        r = run([product("A", stock=5), product("Z", id=2, stock=12)], daily("A", 28, 1, 10))
        z = item(r, "Z")
        self.assertEqual(z["dailyDemand"], 0)
        self.assertEqual(z["status"], "HEALTHY")
        self.assertIsNone(z["daysOfCover"])

    def test_todays_partial_sales_and_unknown_skus_are_ignored(self):
        sales = daily("A", 28, 1, 10) + [
            {"sku": "A", "date": AS_OF.isoformat(), "quantity": 500, "revenue": 5000},
            {"sku": "GHOST", "date": (AS_OF - timedelta(days=2)).isoformat(), "quantity": 9, "revenue": 90},
        ]
        r = run([product(stock=100)], sales)
        self.assertEqual(item(r, "A")["dailyDemand"], 1.0)
        self.assertTrue(any("ignored" in w for w in r["meta"]["warnings"]))


class Status(unittest.TestCase):
    def test_expired_stock_is_flagged(self):
        r = run([product(stock=5, expiryDate="2026-09-01")], daily("A", 28, 1, 10))
        self.assertEqual(item(r, "A")["status"], "EXPIRY RISK")

    def test_will_not_sell_through_before_expiry(self):
        r = run([product(stock=60, expiryDate="2026-10-05")], daily("A", 28, 1, 10))  # 14 days * 1/day < 60
        self.assertEqual(item(r, "A")["status"], "EXPIRY RISK")

    def test_far_expiry_and_dead_stock_do_not_raise_noise(self):
        r = run([product(stock=60, expiryDate="2028-01-01"), product("Z", id=2, stock=9, expiryDate="2028-01-01")],
                daily("A", 28, 1, 10))
        self.assertEqual(item(r, "A")["status"], "HEALTHY")
        self.assertEqual(item(r, "Z")["status"], "HEALTHY")

    def test_only_healthy_uses_healthy_label(self):
        r = run([product(stock=1000)], daily("A", 28, 1, 10))
        self.assertEqual(item(r, "A")["status"], "HEALTHY")
        self.assertEqual(r["kpis"]["highRiskSKUs"], 0)

    def test_risky_items_sort_first(self):
        r = run([product("A", stock=1000), product("B", id=2, stock=1)], daily("A", 28, 1, 10) + daily("B", 28, 1, 10))
        self.assertEqual([i["sku"] for i in r["skuDemandList"]], ["B", "A"])


class Revenue(unittest.TestCase):
    def test_forecast_line_is_flat_daily_revenue_not_a_ramp(self):
        r = run([product(stock=100)], daily("A", 28, 2, 50))
        forecast = [p for p in r["revenueTrajectory"] if p["actual"] is None]
        self.assertEqual(len(forecast), 30)
        self.assertTrue(all(p["forecast"] == 100.0 for p in forecast))
        self.assertEqual(forecast[0]["date"], AS_OF.isoformat())   # continues from today, no gap

    def test_projection_covers_only_the_horizon(self):
        r = run([product(stock=100)], daily("A", 28, 2, 50), days=10)
        self.assertEqual(r["kpis"]["projectedGross"], 1000.0)   # 10 days * 100/day, history is not added

    def test_growth_and_discount_come_from_data(self):
        sales = daily("A", 60, 1, 100)
        tot = totals(sales)
        for t in tot[:6]:
            t["discount"] = t["gross"] * 0.5
        r = build_forecast({"asOf": AS_OF.isoformat(), "daysToForecast": 10, "products": [product(stock=100)],
                            "sales": sales, "dailyTotals": tot})
        self.assertEqual(r["kpis"]["grossGrowth"], "+0.0%")
        self.assertEqual(r["kpis"]["discountRatePct"], 5.0)   # 6 of 60 days at 50%
        self.assertEqual(r["kpis"]["projectedDiscounts"], 50.0)
        self.assertEqual(r["kpis"]["projectedNet"], 950.0)

    def test_growth_is_na_with_little_history(self):
        r = run([product(stock=100)], daily("A", 5, 1, 10))
        self.assertEqual(r["kpis"]["grossGrowth"], "n/a")
        self.assertTrue(r["meta"]["lowData"])

    def test_empty_history_returns_a_valid_response(self):
        r = run([product(stock=3)], [])
        self.assertEqual(r["kpis"]["projectedGross"], 0)
        self.assertEqual(r["revenueTrajectory"], [])
        self.assertEqual(item(r, "A")["status"], "HEALTHY")
        self.assertTrue(r["meta"]["warnings"])

    def test_category_shares_add_up(self):
        p = [product("A", category="X"), product("B", id=2, category="Y")]
        r = run(p, daily("A", 28, 1, 30) + daily("B", 28, 1, 10))
        shares = {c["category"]: c["percentShare"] for c in r["categoryBreakdown"]}
        self.assertEqual(shares, {"X": 75.0, "Y": 25.0})


class Determinism(unittest.TestCase):
    def test_same_input_same_output(self):
        payload = load("forecast_input.json")
        self.assertEqual(build_forecast(payload), build_forecast(copy.deepcopy(payload)))

    def test_row_order_does_not_matter(self):
        payload = load("forecast_input.json")
        shuffled = copy.deepcopy(payload)
        random.Random(7).shuffle(shuffled["sales"])
        random.Random(8).shuffle(shuffled["dailyTotals"])
        random.Random(9).shuffle(shuffled["products"])
        a = build_forecast(payload)
        b = build_forecast(shuffled)
        self.assertEqual(a, b)

    def test_matches_golden_fixture(self):
        self.assertEqual(build_forecast(load("forecast_input.json")), load("forecast_expected.json"))


if __name__ == "__main__":
    unittest.main()
