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
        self.assertEqual(a["reorderQty"], 29)      # restock to lead time + review period, plus safety stock
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


class StockOuts(unittest.TestCase):
    def out_days(self, sku, offsets):
        return [{"sku": sku, "date": (AS_OF - timedelta(days=k)).isoformat()} for k in offsets]

    def sales_with_gaps(self, gaps):
        """4 units a day for 28 days, except no sales at all on the `gaps` (days back from asOf)."""
        return [s for s in daily("A", 28, 4, 10.0) if s["date"] not in {(AS_OF - timedelta(days=k)).isoformat() for k in gaps}]

    def test_days_out_of_stock_are_not_counted_as_zero_demand(self):
        gaps = [2, 3, 9, 10, 16, 17]
        sales = self.sales_with_gaps(gaps)
        ignoring = run([product("A")], sales)
        aware = run([product("A")], sales, stockouts=self.out_days("A", gaps))
        self.assertAlmostEqual(item(ignoring, "A")["dailyDemand"], round(4 * 22 / 28, 2))
        self.assertEqual(item(aware, "A")["dailyDemand"], 4.0)
        self.assertEqual(item(aware, "A")["stockoutDays"], 6)
        self.assertTrue(item(aware, "A")["stockoutAdjusted"])
        self.assertEqual(item(aware, "A")["dataDays"], 22)

    def test_confidence_counts_only_days_with_stock(self):
        gaps = list(range(1, 16))      # out of stock for 15 of 28 days: 13 usable days
        aware = run([product("A")], self.sales_with_gaps(gaps), stockouts=self.out_days("A", gaps))
        self.assertEqual(item(aware, "A")["dataDays"], 13)
        self.assertEqual(item(aware, "A")["confidence"], "low")

    def test_nearly_always_sold_out_is_not_excluded(self):
        gaps = list(range(1, 25))      # 4 usable days left: too few, so nothing is excluded
        sales = self.sales_with_gaps(gaps)
        aware = run([product("A")], sales, stockouts=self.out_days("A", gaps))
        self.assertEqual(item(aware, "A")["stockoutDays"], 0)
        self.assertFalse(item(aware, "A")["stockoutAdjusted"])
        self.assertEqual(item(aware, "A")["dailyDemand"], item(run([product("A")], sales), "A")["dailyDemand"])

    def test_stockouts_outside_the_window_or_for_unknown_products_are_ignored(self):
        sales = daily("A", 28, 4, 10.0)
        stray = self.out_days("A", [0, -1, 400]) + self.out_days("GHOST", [1, 2])
        self.assertEqual(run([product("A")], sales, stockouts=stray), run([product("A")], sales))

    def test_only_the_stocked_out_product_is_adjusted(self):
        sales = daily("A", 28, 4, 10.0) + daily("B", 28, 2, 10.0)
        r = run([product("A"), product("B", id=2)], sales, stockouts=self.out_days("A", [1, 2, 3]))
        self.assertEqual(item(r, "B")["stockoutDays"], 0)
        self.assertFalse(item(r, "B")["stockoutAdjusted"])


class Ranges(unittest.TestCase):
    def setUp(self):
        rng = random.Random(4)
        self.sales = []
        for i in range(40):
            self.sales.append({"sku": "A", "date": (AS_OF - timedelta(days=1 + i)).isoformat(),
                               "quantity": rng.randint(0, 9), "revenue": 0})
        for s in self.sales:
            s["revenue"] = s["quantity"] * 25.0
        self.result = run([product("A")], self.sales)

    def test_forecast_sits_inside_its_range(self):
        a = item(self.result, "A")
        self.assertLessEqual(a["forecast7Low"], a["forecast7Day"])
        self.assertLessEqual(a["forecast7Day"], a["forecast7High"])
        self.assertGreaterEqual(a["forecast7Low"], 0)
        k = self.result["kpis"]
        self.assertLessEqual(k["projectedGrossLow"], k["projectedGross"])
        self.assertLessEqual(k["projectedGross"], k["projectedGrossHigh"])

    def test_steadier_sales_give_a_narrower_range(self):
        steady = item(run([product("A")], daily("A", 40, 5, 25.0)), "A")
        noisy = item(self.result, "A")
        self.assertLess(steady["forecast7High"] - steady["forecast7Low"], noisy["forecast7High"] - noisy["forecast7Low"])

    def test_unit_range_is_never_tighter_than_poisson(self):
        # a product selling exactly 5 a day still cannot be forecast to the unit: counts are noisy
        a = item(run([product("A")], daily("A", 40, 5, 25.0)), "A")
        self.assertGreater(a["forecast7High"], a["forecast7Day"])

    def test_range_grows_with_the_horizon_and_with_little_history(self):
        long = run([product("A")], self.sales, days=60)["kpis"]
        short = run([product("A")], self.sales, days=7)["kpis"]
        self.assertGreater(long["projectedGrossHigh"] - long["projectedGrossLow"],
                           short["projectedGrossHigh"] - short["projectedGrossLow"])
        few = item(run([product("A")], self.sales[:8]), "A")
        many = item(self.result, "A")
        self.assertGreater((few["forecast7High"] - few["forecast7Low"]) / max(few["forecast7Day"], 1),
                           (many["forecast7High"] - many["forecast7Low"]) / max(many["forecast7Day"], 1))

    def test_trajectory_carries_a_band_that_joins_the_actuals(self):
        traj = self.result["revenueTrajectory"]
        joint = next(p for p in reversed(traj) if p["actual"] is not None)
        self.assertEqual((joint["forecastLow"], joint["forecastHigh"]), (joint["actual"], joint["actual"]))
        future = [p for p in traj if p["actual"] is None]
        self.assertTrue(all(p["forecastLow"] <= p["forecast"] <= p["forecastHigh"] for p in future))


class RevenueLevel(unittest.TestCase):
    def rising(self):
        # 28 days ending yesterday: 100/day for the older 14 days, 200/day for the newer 14
        sales = []
        for i in range(28):
            sales.append({"sku": "A", "date": (AS_OF - timedelta(days=1 + i)).isoformat(),
                          "quantity": 1, "revenue": 200.0 if i < 14 else 100.0})
        return sales

    def test_revenue_follows_the_last_14_days(self):
        r = run([product("A")], self.rising(), days=10)
        self.assertEqual(r["kpis"]["projectedGross"], 2000.0)
        self.assertEqual(r["meta"]["revenueWindowDays"], 14)

    def test_previous_version_used_28_days_and_is_still_reproducible(self):
        sales = self.rising()
        payload = {"asOf": AS_OF.isoformat(), "daysToForecast": 10, "products": [product("A")],
                   "sales": sales, "dailyTotals": totals(sales)}
        old = build_forecast(payload, legacy=True)
        self.assertEqual(old["kpis"]["projectedGross"], 1500.0)
        self.assertEqual(old["meta"]["engineVersion"], "1.0.0")

    def test_units_still_use_28_days(self):
        sales = []
        for i in range(28):
            sales.append({"sku": "A", "date": (AS_OF - timedelta(days=1 + i)).isoformat(),
                          "quantity": 4 if i < 14 else 2, "revenue": 10.0})
        self.assertEqual(item(run([product("A")], sales), "A")["dailyDemand"], 3.0)


class Reorder(unittest.TestCase):
    def steady(self, **kw):
        return item(run([product(**kw)], daily("A", 28, 2, 50)), "A")

    def test_reorder_point_is_lead_time_demand_plus_safety_stock(self):
        a = self.steady(stock=100, leadTimeDays=7)
        # 2/day for 7 days = 14, plus 95% safety stock: sqrt(7*2 + 49*2/28) * 1.6449 = 6.9
        self.assertEqual(a["safetyStock"], 6.9)
        self.assertEqual(a["reorderPoint"], 21)
        self.assertEqual(a["status"], "HEALTHY")

    def test_longer_lead_time_means_reorder_earlier(self):
        short = self.steady(stock=25, leadTimeDays=3)
        long = self.steady(stock=25, leadTimeDays=14)
        self.assertLess(short["reorderPoint"], long["reorderPoint"])
        self.assertEqual(short["status"], "HEALTHY")
        self.assertEqual(long["status"], "REORDER NOW")

    def test_missing_lead_time_defaults_to_seven_days(self):
        self.assertEqual(self.steady(stock=100)["leadTimeDays"], 7)

    def test_pending_orders_count_as_stock_on_the_way(self):
        flagged = self.steady(stock=10)
        covered = self.steady(stock=10, onOrder=40)
        self.assertEqual(flagged["status"], "REORDER NOW")
        self.assertEqual(covered["status"], "HEALTHY")
        self.assertEqual(covered["reorderQty"], 0)
        self.assertEqual(covered["onOrder"], 40)

    def test_suggested_quantity_restocks_to_order_up_to_level_minus_position(self):
        a = self.steady(stock=10, onOrder=5)
        self.assertEqual(a["reorderQty"], a["orderUpTo"] - 15)
        self.assertGreater(a["orderUpTo"], a["reorderPoint"])

    def test_min_stock_is_a_floor_under_the_reorder_point(self):
        a = self.steady(stock=30, minStock=40)
        self.assertEqual(a["reorderPoint"], 40)
        self.assertEqual(a["status"], "REORDER NOW")

    def test_product_without_sales_history_still_follows_min_stock(self):
        r = run([product("N", stock=3, minStock=10)], daily("A", 28, 1, 10))
        n = item(r, "N")
        self.assertEqual((n["reorderPoint"], n["status"], n["reorderQty"]), (10, "REORDER NOW", 7))

    def test_dead_product_with_no_minimum_is_not_flagged(self):
        r = run([product("N", stock=0, minStock=0)], daily("A", 28, 1, 10))
        self.assertEqual((item(r, "N")["status"], item(r, "N")["reorderQty"]), ("HEALTHY", 0))

    def test_noisier_sales_need_more_safety_stock(self):
        rng = random.Random(2)
        noisy = []
        for i in range(28):
            noisy += daily("A", 1, rng.choice([0, 0, 1, 6, 5]), 50, start_offset=1 + i)
        mean = sum(s["quantity"] for s in noisy) / 28
        steady = item(run([product(stock=100)], daily("A", 28, round(mean), 50)), "A")
        self.assertGreater(item(run([product(stock=100)], noisy), "A")["safetyStock"], steady["safetyStock"])

    def test_expired_stock_still_reads_as_expiry_risk_before_reorder(self):
        a = self.steady(stock=1, expiryDate="2026-09-01")
        self.assertEqual(a["status"], "EXPIRY RISK")

    def test_expired_stock_cannot_cover_demand_so_a_full_order_is_suggested(self):
        expired = self.steady(stock=500, expiryDate="2026-09-01")
        self.assertEqual(expired["reorderQty"], expired["orderUpTo"])
        fresh = self.steady(stock=500, expiryDate="2028-01-01")
        self.assertEqual(fresh["reorderQty"], 0)


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
