"""Deterministic demand & revenue forecast engine.

Pure functions, standard library only: the same input always gives the same output (no clock, no
randomness), which keeps forecasts reproducible and lets the backend's JavaScript fallback
(backend/services/forecastEngine.js) implement the identical algorithm. Both are checked against the
same golden fixture (ai-service/tests/fixtures), so change them together.

Engine "rate-mean" (2.x): demand rate = units sold per calendar day over the last 28 days a product
existed, counting days with no sales as zero but skipping days the product was out of stock (those
zeros are lost sales, not lack of demand) -- and skipping days the whole store recorded no sales at
all (e.g. a gap between an imported history and this system going live), the same way, unless too
little real trading history would be left in the window, in which case (2.2.0) the rate is learned
from the most recent real trading days found by reaching further back, up to the full history
lookback, instead of giving up and counting the gap as zero; a warning notes when this happened.
Store revenue uses the last 14 days, which follows a moving level sooner than 28 does (measured with
backtest.py, see CLAUDE.md). Every forecast carries an 80% range.
The revenue trajectory chart (2.3.0) is reshaped by day-of-week -- learned from real (non-simulated)
trading days across the full history, each weekday trusted only once it has MIN_WEEKDAY_OBS real
observations, otherwise left flat -- but this never changes the KPI totals (projectedGross etc.) or
per-SKU demand, which still use the plain flat rate: only the chart's daily split changes. Skipped
entirely under legacy=True, which must keep reproducing the frozen 1.0.0 shape too.
Version 1.0.0's forecasts (28 days for revenue, stock-outs ignored) stay reproducible behind `legacy=True`
so the backtest can keep proving that the current version is better than the one it replaced.

Reorder decisions (2.1.0): reorder point = expected demand over the supplier's lead time + safety stock
(95% one-sided, from the same uncertainty that gives the ranges), never below the product's own minStock.
A product is flagged when on hand + already on order (pending purchase orders) is at or below it, and the
suggested quantity restocks it to lead time + a 7-day review period of demand plus safety stock.

Money is summed in integer cents so results do not depend on row order. Dates are ISO
"YYYY-MM-DD" strings in the store's local time zone, supplied by the caller.
"""
import math
from datetime import date

from forecast_stats import SERVICE_Z, range_for_total, sample_variance, total_sd, window_mean

ENGINE_NAME = "rate-mean"
ENGINE_VERSION = "2.3.0"
LEGACY_VERSION = "1.0.0"

RATE_WINDOW_DAYS = 28          # how many recent days set a product's demand rate
REVENUE_WINDOW_DAYS = 14       # how many recent days set the store's revenue rate
TRAJECTORY_HISTORY_DAYS = 30   # days of actuals drawn before the forecast line
MIN_WEEKDAY_OBS = 4            # real (non-simulated) trading days needed before trusting a weekday's shape
WEEKDAYS = 7
EXPIRY_HORIZON_DAYS = 180      # only judge sell-through against expiry dates this close
MIN_DAYS_FOR_GROWTH = 14       # below this, growth and confidence are not meaningful
MIN_USABLE_DAYS = 7            # fewer in-stock days than this in the window: stock-outs are not excluded
DEFAULT_LEAD_TIME_DAYS = 7     # used when a product's supplier has no lead time
REVIEW_DAYS = 7                # how often stock is reviewed: a reorder covers lead time plus this many days
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


def _weekday(n):
    return date.fromordinal(n).weekday()  # 0=Mon..6=Sun


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
    # Days made entirely of synthetic (SIM-*) transactions -- a data-gap fill with no real day-of-week
    # signal (see backend/models/salesHistory.js). Still counted toward the store's level/rate, just
    # not its weekday shape.
    simulated_days = set()
    totals = payload.get("dailyTotals") or []
    if totals:
        for t in totals:
            d = _day(t["date"])
            if window_start <= d <= window_end:
                cell = store_days.setdefault(d, [0, 0])
                cell[0] += _cents(t["gross"])
                cell[1] += _cents(t["discount"])
                if t.get("simulated"):
                    simulated_days.add(d)
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
    idle_days = 0  # days with no sales anywhere in the store, actually skipped (reported in meta)
    stale_since_days = None  # set when the rate had to be learned from trading days older than the usual window
    if store_start is not None:
        first = max(store_start, window_end - RATE_WINDOW_DAYS + 1)
        span_days = window_end - first + 1
        # Idle-day skipping is new in 2.x; legacy=True must keep reproducing the frozen 1.0.0 numbers.
        idle_in_span = 0 if legacy else sum(1 for d in range(first, window_end + 1) if d not in store_days)
        # A day with no sales anywhere in the store (not just one product out of stock) says nothing
        # about demand -- the store simply wasn't recording sales that day (e.g. a gap between an
        # imported history and this system going live). Skip it like a stock-out, unless doing so
        # would leave too little real trading history in the window to learn from.
        skip_idle = idle_in_span > 0 and span_days - idle_in_span >= MIN_USABLE_DAYS
        if skip_idle:
            idle_days = idle_in_span
        if idle_in_span == 0 or skip_idle:
            recent = [None if (skip_idle and d not in store_days) else store_days.get(d, [0, 0])[0]
                      for d in range(first, window_end + 1)]
        else:
            # The normal window doesn't have enough real trading days to learn from even after
            # skipping idle ones -- the gap itself has outgrown the window (e.g. a month or more
            # between an imported history and this system going live). Reach further back, up to the
            # full history lookback, for the most recent real trading days instead of averaging in a
            # long run of zeros.
            recent = []
            oldest = None
            d = window_end
            while d >= window_start and len(recent) < revenue_window:
                if d in store_days:
                    recent.insert(0, store_days[d][0])
                    oldest = d
                d -= 1
            if len(recent) < MIN_USABLE_DAYS:
                # Even the full history doesn't have enough real trading days -- there is truly
                # nothing reliable to learn from, so fall back to the plain calendar-window average
                # (the gap counts as zero) same as before, rather than trusting a handful of very
                # old points.
                recent = [store_days.get(d, [0, 0])[0] for d in range(first, window_end + 1)]
            elif oldest is not None and oldest < first:
                stale_since_days = window_end - oldest
        level = window_mean(recent, revenue_window)
        rate_cents, level_days = level if level else (0.0, 1)
        store_variance = sample_variance(recent)

        total_gross = sum(v[0] for v in store_days.values())
        total_discount = sum(v[1] for v in store_days.values())
        discount_ratio = total_discount / total_gross if total_gross > 0 else 0.0
        # Trading days only, not the calendar span -- a day the store recorded nothing shouldn't drag
        # the historical average down just because it sits inside the window. (Legacy keeps the old
        # calendar-span denominator, for the same reproducibility reason as above.)
        trading_days = observed_days if legacy else len(store_days)
        hist_avg = total_gross / trading_days if trading_days > 0 else 0.0
        if observed_days >= MIN_DAYS_FOR_GROWTH and hist_avg > 0:
            growth_pct = _round((rate_cents / hist_avg - 1) * 100, 1)
    if idle_days > 0:
        warnings.append(f"{idle_days} day(s) with no store-wide sales were treated as no data, not zero demand.")
    if stale_since_days is not None:
        warnings.append(
            f"No recent store-wide sales in the last {RATE_WINDOW_DAYS} days; revenue is estimated from the "
            f"most recent real trading day(s), up to {stale_since_days} day(s) ago."
        )

    # --- weekday shape for the trajectory (2.3.0): the flat rate above is never changed, only how
    # it's split across the chart's daily points -- learned from real (non-simulated) trading days
    # across the full history window, each weekday trusted only once it has MIN_WEEKDAY_OBS real
    # observations. Skipped under legacy=True, which must keep reproducing the frozen 1.0.0 shape too.
    weekday_sum = [0] * WEEKDAYS
    weekday_count = [0] * WEEKDAYS
    real_total_cents = 0
    real_day_count = 0
    if not legacy:
        for d, (gross, _) in store_days.items():
            if d in simulated_days:
                continue
            wd = _weekday(d)
            weekday_sum[wd] += gross
            weekday_count[wd] += 1
            real_total_cents += gross
            real_day_count += 1
    overall_mean = real_total_cents / real_day_count if real_day_count > 0 else 0.0
    weekday_factor = [1.0] * WEEKDAYS
    shaped_weekdays = 0
    if overall_mean > 0:
        for wd in range(WEEKDAYS):
            if weekday_count[wd] >= MIN_WEEKDAY_OBS:
                weekday_factor[wd] = weekday_sum[wd] / weekday_count[wd] / overall_mean
                shaped_weekdays += 1
    if not legacy and shaped_weekdays == 0:
        warnings.append("Not enough real trading history yet to shape the forecast by day of week; showing a flat daily average.")

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
        low_margin = rate_cents - day_low   # kept constant per day, just recentered on the shaped value
        high_margin = day_high - rate_cents
        # Reshape the flat rate by weekday, then rescale the horizon's days so their sum still equals
        # rate_cents * horizon exactly -- the KPI totals above never change, only the daily split.
        raw_shaped = [rate_cents * weekday_factor[_weekday(as_of + i)] for i in range(horizon)]
        raw_sum = 0.0
        for v in raw_shaped:
            raw_sum += v
        shape_scale = (rate_cents * horizon) / raw_sum if raw_sum > 0 else 1.0
        for i in range(horizon):
            d = as_of + i
            shaped = raw_shaped[i] * shape_scale
            trajectory.append({
                "day": _label(d), "date": _iso(d), "actual": None,
                "forecast": _round(shaped / 100, 2),
                "forecastLow": _round(max(0.0, shaped - low_margin) / 100, 2),
                "forecastHigh": _round((shaped + high_margin) / 100, 2),
            })

    # --- per-SKU demand and status -------------------------------------------------------------
    items = []
    category_cents = {}
    stale_sku_count = 0  # products whose demand rate had to reach past the usual window (see below)
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
        sd_lead = sd_cycle = 0.0
        lead = max(1, int(p.get("leadTimeDays") or DEFAULT_LEAD_TIME_DAYS))
        stockouts = 0
        adjusted = False
        if sku_start is not None and sku_start <= window_end:
            rate_start = max(sku_start, window_end - RATE_WINDOW_DAYS + 1)
            for d in range(rate_start, window_end + 1):
                cell = by_day.get(d)
                if cell:
                    cents += cell[1]

            # A day is excluded either because this product was personally out of stock, or because
            # the whole store recorded no sales that day (see the store-revenue block above) -- neither
            # kind of zero says anything about this product's demand.
            out_of_stock = stockout_days.get(p["sku"], set())
            excluded = {d for d in range(rate_start, window_end + 1)
                        if d in out_of_stock or (not legacy and d not in store_days)}
            span_days = window_end - rate_start + 1
            if excluded and span_days - len(excluded) < MIN_USABLE_DAYS:
                # Too little real, in-stock trading history inside the normal window -- the gap has
                # outgrown the window itself. Reach further back, up to the full history lookback,
                # for the most recent days this product actually had a chance to sell on, instead of
                # giving up and averaging in a long run of zeros (see the store-revenue block above).
                excluded = set()
                recent = []
                oldest = None
                reach_back = max(sku_start, window_start)
                d = window_end
                while d >= reach_back and len(recent) < RATE_WINDOW_DAYS:
                    if d not in out_of_stock and d in store_days:
                        recent.insert(0, by_day.get(d, [0, 0])[0])
                        oldest = d
                    d -= 1
                if len(recent) < MIN_USABLE_DAYS:
                    # Not enough real, in-stock trading days anywhere in history either -- fall back
                    # to the plain calendar-window average (stock-outs/gaps count as zero) same as
                    # before.
                    recent = [by_day.get(d, [0, 0])[0] for d in range(rate_start, window_end + 1)]
                elif oldest is not None and oldest < rate_start:
                    stale_sku_count += 1
            else:
                recent = [None if d in excluded else by_day.get(d, [0, 0])[0] for d in range(rate_start, window_end + 1)]
            stockouts = sum(1 for d in range(rate_start, window_end + 1) if d in out_of_stock and d in excluded)
            adjusted = stockouts > 0

            level = window_mean(recent, RATE_WINDOW_DAYS)
            rate, data_days = level if level else (0.0, 0)
            variance = sample_variance(recent)
            low7, high7 = range_for_total(rate, data_days, variance, 7, count_data=True)
            sd_lead = total_sd(rate, data_days, variance, lead, count_data=True)
            sd_cycle = total_sd(rate, data_days, variance, lead + REVIEW_DAYS, count_data=True)

        stock = max(0, int(p.get("stock") or 0))
        on_order = max(0, int(p.get("onOrder") or 0))
        min_stock = int(p.get("minStock") or 0)
        forecast7 = rate * 7
        days_to_expiry = (_day(p["expiryDate"]) - as_of) if p.get("expiryDate") else None
        sellable = 0 if days_to_expiry is not None and days_to_expiry <= 0 else stock   # expired stock cannot be sold
        safety = SERVICE_Z * sd_lead
        reorder_point = max(int(math.ceil(rate * lead + safety - EPS)), min_stock)
        order_up_to = max(int(math.ceil(rate * (lead + REVIEW_DAYS) + SERVICE_Z * sd_cycle - EPS)), reorder_point)
        position = sellable + on_order
        needs_order = reorder_point > 0 and position <= reorder_point

        if days_to_expiry is not None and days_to_expiry <= 0 and stock > 0:
            status = STATUS_EXPIRY          # already expired stock
        elif needs_order:
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
            "minStock": min_stock,
            "dailyDemand": _round(rate, 2),
            "forecast7Day": _round(forecast7, 1),
            "forecast7Low": _round(low7, 1),
            "forecast7High": _round(high7, 1),
            "forecastHorizon": _round(rate * horizon, 1),
            "leadTimeDays": lead,
            "onOrder": on_order,
            "safetyStock": _round(safety, 1),
            "reorderPoint": reorder_point,
            "orderUpTo": order_up_to,
            "reorderQty": max(1, order_up_to - position) if needs_order else 0,
            "daysOfCover": _round(stock / rate, 1) if rate > 0 else None,
            "status": status,
            "confidence": _confidence(data_days),
            "dataDays": data_days,
            "stockoutDays": stockouts,
            "stockoutAdjusted": adjusted,
        })
    if stale_sku_count > 0:
        warnings.append(
            f"{stale_sku_count} product(s) have no recent sales in the last {RATE_WINDOW_DAYS} days; "
            "their demand is estimated from older trading days instead."
        )
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
            "idleDays": idle_days,
            "rateWindowDays": RATE_WINDOW_DAYS,
            "revenueWindowDays": revenue_window,
            "rangeLevel": 0.8,
            "serviceLevel": 0.95,
            "reviewDays": REVIEW_DAYS,
            "skuCount": len(items),
            "lowData": observed_days < MIN_DAYS_FOR_GROWTH,
            "warnings": warnings,
        },
    }
