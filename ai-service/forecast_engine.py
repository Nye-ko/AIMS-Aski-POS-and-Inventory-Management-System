"""Deterministic demand & revenue forecast engine.

Pure functions, standard library only: the same input always gives the same output (no clock, no
randomness), which keeps forecasts reproducible and lets the backend's JavaScript fallback
(backend/services/forecastEngine.js) implement the identical algorithm. Both are checked against the
same golden fixture (ai-service/tests/fixtures), so change them together.

Engine "rate-mean" 2.0.0: demand rate = units sold per calendar day over the last 28 days a product
existed, counting days with no sales as zero but skipping days the product was out of stock (those
zeros are lost sales, not lack of demand). Store revenue uses the last 14 days, which follows a moving
level sooner than 28 does (measured with backtest.py, see CLAUDE.md). Every forecast carries an 80% range.
Version 1.0.0 (28 days for revenue, stock-outs ignored, no ranges) stays available behind `legacy=True`
so the backtest can keep proving that the current version is better than the one it replaced.

Money is summed in integer cents so results do not depend on row order. Dates are ISO
"YYYY-MM-DD" strings in the store's local time zone, supplied by the caller.
"""
import math
from datetime import date

from forecast_stats import range_for_total, sample_variance, window_mean

ENGINE_NAME = "rate-mean"
ENGINE_VERSION = "2.0.0"
LEGACY_VERSION = "1.0.0"

RATE_WINDOW_DAYS = 28          # how many recent days set a product's demand rate
REVENUE_WINDOW_DAYS = 14       # how many recent days set the store's revenue rate
TRAJECTORY_HISTORY_DAYS = 30   # days of actuals drawn before the forecast line
EXPIRY_HORIZON_DAYS = 180      # only judge sell-through against expiry dates this close
MIN_DAYS_FOR_GROWTH = 14       # below this, growth and confidence are not meaningful
MIN_USABLE_DAYS = 7            # fewer in-stock days than this in the window: stock-outs are not excluded
EPS = 1e-9

STATUS_REORDER = "REORDER NOW"
STATUS_EXPIRY = "EXPIRY RISK"
STATUS_OK = "HEALTHY"
_STATUS_ORDER = {STATUS_REORDER: 0, STATUS_EXPIRY: 1, STATUS_OK: 2}

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _round(x, digits):
    """Round half up (Python's round() is banker's rounding and would diverge from JavaScript)."""
    f = 10 ** digits
    return math.floor(x * f + 0.5) / f + 0.0


def _cents(x):
    return int(math.floor(float(x) * 100 + 0.5))


def _day(iso):
    return date.fromisoformat(iso).toordinal()


def _iso(n):
    return date.fromordinal(n).isoformat()


def _label(n):
    d = date.fromordinal(n)
    return f"{_MONTHS[d.month - 1]} {d.day:02d}"


def _confidence(data_days):
    if data_days <= 0:
        return "none"
    if data_days < MIN_DAYS_FOR_GROWTH:
        return "low"
    if data_days < RATE_WINDOW_DAYS:
        return "medium"
    return "high"


def build_forecast(payload, source="ai-service", legacy=False):
    version = LEGACY_VERSION if legacy else ENGINE_VERSION
    revenue_window = RATE_WINDOW_DAYS if legacy else REVENUE_WINDOW_DAYS
    as_of = _day(payload["asOf"])
    horizon = int(payload["daysToForecast"])
    history_days = int(payload.get("historyDays", 180))
    window_end = as_of - 1                 # last complete day; today is still being rung up
    window_start = as_of - history_days
    warnings = []

    products = payload.get("products") or []
    known = {p["sku"] for p in products}

    # --- sales per SKU per day (units, cents) inside the window --------------------------------
    sku_days = {}
    ignored = 0
    for s in payload.get("sales") or []:
        d = _day(s["date"])
        if d < window_start or d > window_end:
            continue
        if s["sku"] not in known:
            ignored += 1
            continue
        cell = sku_days.setdefault(s["sku"], {}).setdefault(d, [0, 0])
        cell[0] += int(s["quantity"])
        cell[1] += _cents(s["revenue"])
    if ignored:
        warnings.append(f"{ignored} sales rows ignored (unknown product).")

    # --- days each product was out of stock (its zero sales there are not demand) --------------
    stockout_days = {}
    if not legacy:
        for s in payload.get("stockouts") or []:
            d = _day(s["date"])
            if window_start <= d <= window_end and s["sku"] in known:
                stockout_days.setdefault(s["sku"], set()).add(d)

    # --- store-level daily gross / discount (cents) --------------------------------------------
    store_days = {}
    totals = payload.get("dailyTotals") or []
    if totals:
        for t in totals:
            d = _day(t["date"])
            if window_start <= d <= window_end:
                cell = store_days.setdefault(d, [0, 0])
                cell[0] += _cents(t["gross"])
                cell[1] += _cents(t["discount"])
    else:
        for by_day in sku_days.values():
            for d, (_, cents) in by_day.items():
                store_days.setdefault(d, [0, 0])[0] += cents

    all_days = list(store_days) + [d for by_day in sku_days.values() for d in by_day]
    store_start = min(all_days) if all_days else None
    observed_days = 0 if store_start is None else window_end - store_start + 1

    if store_start is None:
        warnings.append(f"No sales history in the last {history_days} days; demand is shown as 0.")
    elif observed_days < MIN_DAYS_FOR_GROWTH:
        warnings.append(f"Only {observed_days} days of sales history; forecasts are low confidence.")

    # --- store revenue: rate, range, discounts, growth -----------------------------------------
    rate_cents = 0.0
    level_days = 1
    store_variance = None
    discount_ratio = 0.0
    growth_pct = None
    if store_start is not None:
        first = max(store_start, window_end - RATE_WINDOW_DAYS + 1)
        recent = [store_days.get(d, [0, 0])[0] for d in range(first, window_end + 1)]
        rate_cents, level_days = window_mean(recent, revenue_window)
        store_variance = sample_variance(recent)

        total_gross = sum(v[0] for v in store_days.values())
        total_discount = sum(v[1] for v in store_days.values())
        discount_ratio = total_discount / total_gross if total_gross > 0 else 0.0
        hist_avg = total_gross / observed_days
        if observed_days >= MIN_DAYS_FOR_GROWTH and hist_avg > 0:
            growth_pct = _round((rate_cents / hist_avg - 1) * 100, 1)

    low_cents, high_cents = range_for_total(rate_cents, level_days, store_variance, horizon)
    projected_gross = _round(rate_cents * horizon / 100, 2)
    projected_low = _round(low_cents / 100, 2)
    projected_high = _round(high_cents / 100, 2)
    projected_discounts = _round(projected_gross * discount_ratio, 2)
    projected_net = _round(projected_gross - projected_discounts, 2)
    if growth_pct is None:
        gross_growth = "n/a"
    else:
        gross_growth = f"{'+' if growth_pct >= 0 else '-'}{abs(growth_pct):.1f}%"

    # --- trajectory: recent actuals, then the daily forecast with its range --------------------
    trajectory = []
    if store_start is not None:
        first = max(store_start, window_end - TRAJECTORY_HISTORY_DAYS + 1)
        for d in range(first, window_end + 1):
            trajectory.append({
                "day": _label(d), "date": _iso(d),
                "actual": _round(store_days.get(d, [0, 0])[0] / 100, 2), "forecast": None,
                "forecastLow": None, "forecastHigh": None,
            })
        joint = trajectory[-1]              # join the two lines
        joint["forecast"] = joint["forecastLow"] = joint["forecastHigh"] = joint["actual"]
        day_low, day_high = range_for_total(rate_cents, level_days, store_variance, 1)
        for i in range(horizon):
            d = as_of + i
            trajectory.append({
                "day": _label(d), "date": _iso(d), "actual": None,
                "forecast": _round(rate_cents / 100, 2),
                "forecastLow": _round(day_low / 100, 2), "forecastHigh": _round(day_high / 100, 2),
            })

    # --- per-SKU demand and status -------------------------------------------------------------
    items = []
    category_cents = {}
    for p in products:
        by_day = sku_days.get(p["sku"], {})
        candidates = []
        if p.get("createdAt"):
            candidates.append(_day(p["createdAt"]))
        if by_day:
            candidates.append(min(by_day))
        sku_start = None
        if store_start is not None:
            sku_start = max(min(candidates) if candidates else store_start, store_start)

        data_days = 0
        cents = 0
        rate = 0.0
        low7 = high7 = 0.0
        stockouts = 0
        adjusted = False
        if sku_start is not None and sku_start <= window_end:
            rate_start = max(sku_start, window_end - RATE_WINDOW_DAYS + 1)
            for d in range(rate_start, window_end + 1):
                cell = by_day.get(d)
                if cell:
                    cents += cell[1]

            out = stockout_days.get(p["sku"], set())
            stockouts = sum(1 for d in range(rate_start, window_end + 1) if d in out)
            if stockouts and (window_end - rate_start + 1) - stockouts < MIN_USABLE_DAYS:
                out = set()                 # nearly always sold out: too little left to learn from
                stockouts = 0
            adjusted = stockouts > 0

            recent = [None if d in out else by_day.get(d, [0, 0])[0] for d in range(rate_start, window_end + 1)]
            rate, data_days = window_mean(recent, RATE_WINDOW_DAYS)
            low7, high7 = range_for_total(rate, data_days, sample_variance(recent), 7, count_data=True)

        stock = max(0, int(p.get("stock") or 0))
        forecast7 = rate * 7
        days_to_expiry = (_day(p["expiryDate"]) - as_of) if p.get("expiryDate") else None

        if days_to_expiry is not None and days_to_expiry <= 0 and stock > 0:
            status = STATUS_EXPIRY          # already expired stock
        elif forecast7 > 0 and stock <= forecast7:
            status = STATUS_REORDER
        elif (days_to_expiry is not None and stock > 0 and days_to_expiry <= EXPIRY_HORIZON_DAYS
              and stock > rate * days_to_expiry):
            status = STATUS_EXPIRY          # will not sell through before it expires
        else:
            status = STATUS_OK

        category = p.get("category") or "Uncategorized"
        category_cents[category] = category_cents.get(category, 0) + cents

        items.append({
            "id": p["id"],
            "sku": p["sku"],
            "name": p["name"],
            "category": category,
            "stock": stock,
            "minStock": int(p.get("minStock") or 0),
            "dailyDemand": _round(rate, 2),
            "forecast7Day": _round(forecast7, 1),
            "forecast7Low": _round(low7, 1),
            "forecast7High": _round(high7, 1),
            "forecastHorizon": _round(rate * horizon, 1),
            "reorderQty": int(math.ceil(max(0.0, forecast7 - stock) - EPS)),
            "daysOfCover": _round(stock / rate, 1) if rate > 0 else None,
            "status": status,
            "confidence": _confidence(data_days),
            "dataDays": data_days,
            "stockoutDays": stockouts,
            "stockoutAdjusted": adjusted,
        })
    items.sort(key=lambda i: (_STATUS_ORDER[i["status"]], i["sku"]))

    # --- category breakdown (share of recent revenue applied to the projection) ----------------
    total_cents = sum(category_cents.values())
    categories = []
    if total_cents > 0:
        for name, c in sorted(category_cents.items(), key=lambda kv: (-kv[1], kv[0])):
            share = c / total_cents
            categories.append({
                "category": name,
                "projectedRevenue": _round(projected_gross * share, 2),
                "percentShare": _round(share * 100, 1),
            })

    return {
        "kpis": {
            "projectedGross": projected_gross,
            "projectedGrossLow": projected_low,
            "projectedGrossHigh": projected_high,
            "projectedNet": projected_net,
            "projectedDiscounts": projected_discounts,
            "discountRatePct": _round(discount_ratio * 100, 2),
            "grossGrowth": gross_growth,
            "highRiskSKUs": sum(1 for i in items if i["status"] != STATUS_OK),
            "horizonDays": horizon,
        },
        "revenueTrajectory": trajectory,
        "categoryBreakdown": categories,
        "skuDemandList": items,
        "meta": {
            "source": source,
            "engine": ENGINE_NAME,
            "engineVersion": version,
            "asOf": payload["asOf"],
            "timezone": payload.get("timezone"),
            "historyDays": history_days,
            "observedDays": observed_days,
            "rateWindowDays": RATE_WINDOW_DAYS,
            "revenueWindowDays": revenue_window,
            "rangeLevel": 0.8,
            "skuCount": len(items),
            "lowData": observed_days < MIN_DAYS_FOR_GROWTH,
            "warnings": warnings,
        },
    }
