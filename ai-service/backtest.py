"""Rolling-origin backtest of the production forecast engine.

For each past "origin" day the engine is run exactly as it would have been that morning (it only ever
sees sales before its asOf date), and its forecast for the next days is compared with what really sold.
Every forecast is also compared with a naive baseline, "the next N days will look like the previous N
days", so the result answers the question that matters: is the model better than a simple guess?

Graded: per-product units over the next 7 days (what reorder decisions use) and total store revenue over
the next 7 and 30 days (what the KPIs use). Errors are WAPE (sum of absolute errors / sum of actuals)
and bias (net over/under-forecast as a share of actuals). Pure functions, stdlib only.
"""
import math
from datetime import date

from forecast_engine import ENGINE_NAME, ENGINE_VERSION, MIN_DAYS_FOR_GROWTH, build_forecast

UNITS_HORIZON = 7
REVENUE_HORIZONS = (7, 30)
MIN_TRAIN_DAYS = MIN_DAYS_FOR_GROWTH   # an origin needs at least this much history before it
MAX_ORIGINS = 42                       # most recent origins used, to bound the work
MIN_SAMPLES = 5                        # fewer graded forecasts than this -> "insufficient"
SKILL_MARGIN = 0.05                    # better/worse than baseline only beyond +/-5%


def _day(iso):
    return date.fromisoformat(iso).toordinal()


def _iso(n):
    return date.fromordinal(n).isoformat()


def _r(x, digits=4):
    """Round half up, identically to backend/services/forecastAccuracy.js (Python's round() differs.)"""
    if x is None:
        return None
    f = 10 ** digits
    return math.floor(x * f + 0.5) / f + 0.0


def _add(values):
    """Plain left-to-right addition. Python 3.12+ sum() compensates floats, which would differ from
    JavaScript in the last digit; the graders must agree exactly with backend/services/forecastAccuracy.js."""
    total = 0
    for v in values:
        total += v
    return total


def _errors(pairs):
    """pairs: [(forecast, actual)] -> {wape, bias, mae}; WAPE/bias are None when nothing sold."""
    if not pairs:
        return {"wape": None, "bias": None, "mae": None}
    actual = _add(a for _, a in pairs)
    abs_err = _add(abs(f - a) for f, a in pairs)
    net_err = _add(f - a for f, a in pairs)
    return {
        "wape": _r(abs_err / actual) if actual > 0 else None,
        "bias": _r(net_err / actual) if actual > 0 else None,
        "mae": _r(abs_err / len(pairs), 3),
    }


def summarize(rows):
    """rows: [(forecast, actual, naive)] -> model vs baseline errors, skill and a plain verdict."""
    model = _errors([(f, a) for f, a, _ in rows])
    baseline = _errors([(n, a) for _, a, n in rows])
    skill = None
    if model["wape"] is not None and baseline["wape"] not in (None, 0):
        skill = _r(1 - model["wape"] / baseline["wape"])

    if len(rows) < MIN_SAMPLES or model["wape"] is None:
        verdict = "insufficient"
    elif baseline["wape"] == 0:
        verdict = "similar" if model["wape"] == 0 else "worse"
    elif skill is None:
        verdict = "insufficient"
    elif skill > SKILL_MARGIN:
        verdict = "better"
    elif skill < -SKILL_MARGIN:
        verdict = "worse"
    else:
        verdict = "similar"

    return {
        "n": len(rows),
        "actualTotal": _r(_add(a for _, a, _ in rows), 2),
        "forecastTotal": _r(_add(f for f, _, _ in rows), 2),
        "model": model,
        "baseline": baseline,
        "skill": skill,
        "verdict": verdict,
    }


def run_backtest(payload, max_origins=MAX_ORIGINS):
    as_of = _day(payload["asOf"])
    history_days = int(payload.get("historyDays", 180))
    window_end = as_of - 1
    window_start = as_of - history_days

    products = payload.get("products") or []
    by_sku = {p["sku"]: p for p in products}

    units = {}       # sku -> day -> units
    gross = {}       # day -> gross revenue
    for s in payload.get("sales") or []:
        d = _day(s["date"])
        if window_start <= d <= window_end and s["sku"] in by_sku:
            cell = units.setdefault(s["sku"], {})
            cell[d] = cell.get(d, 0) + int(s["quantity"])
    totals = payload.get("dailyTotals") or []
    if totals:
        for t in totals:
            d = _day(t["date"])
            if window_start <= d <= window_end:
                gross[d] = gross.get(d, 0.0) + float(t["gross"])
    else:
        for s in payload.get("sales") or []:
            d = _day(s["date"])
            if window_start <= d <= window_end and s["sku"] in by_sku:
                gross[d] = gross.get(d, 0.0) + float(s["revenue"])

    all_days = list(gross) + [d for by_day in units.values() for d in by_day]
    meta = {
        "asOf": payload["asOf"],
        "engine": ENGINE_NAME,
        "engineVersion": ENGINE_VERSION,
        "unitsHorizonDays": UNITS_HORIZON,
        "baseline": "previous period of the same length",
        "originsUsed": 0,
        "firstOrigin": None,
        "lastOrigin": None,
        "observedDays": 0,
    }
    empty = summarize([])
    result = {"meta": meta, "units7": empty, "revenue7": empty, "revenue30": empty, "perSku": []}
    if not all_days:
        return result

    store_start = min(all_days)
    meta["observedDays"] = window_end - store_start + 1

    first_origin = store_start + MIN_TRAIN_DAYS
    last_origin = window_end - UNITS_HORIZON + 1          # origin + 6 days must already be observed
    origins = list(range(first_origin, last_origin + 1))[-max_origins:]
    if not origins:
        return result
    meta.update({"originsUsed": len(origins), "firstOrigin": _iso(origins[0]), "lastOrigin": _iso(origins[-1])})

    def total(series, lo, hi):
        return sum(series.get(d, 0) for d in range(lo, hi + 1))

    unit_rows = []                       # (forecast, actual, naive)
    sku_rows = {}                        # sku -> [(forecast, actual, naive)]
    rev_rows = {h: [] for h in REVENUE_HORIZONS}

    for o in origins:
        forecast = build_forecast({**payload, "asOf": _iso(o), "daysToForecast": max(REVENUE_HORIZONS)}, source="backtest")

        for item in forecast["skuDemandList"]:
            if item["dataDays"] <= 0:
                continue                 # product did not exist yet at this origin
            series = units.get(item["sku"], {})
            row = (
                item["forecast7Day"],
                total(series, o, o + UNITS_HORIZON - 1),
                total(series, o - UNITS_HORIZON, o - 1),
            )
            unit_rows.append(row)
            sku_rows.setdefault(item["sku"], []).append(row)

        future = [p["forecast"] for p in forecast["revenueTrajectory"] if p["actual"] is None]
        for h in REVENUE_HORIZONS:
            if o + h - 1 > window_end or o - h < store_start or len(future) < h:
                continue                 # outcome not fully observed yet, or too little history for the baseline
            rev_rows[h].append((sum(future[:h]), total(gross, o, o + h - 1), total(gross, o - h, o - 1)))

    result["units7"] = summarize(unit_rows)
    result["revenue7"] = summarize(rev_rows[7])
    result["revenue30"] = summarize(rev_rows[30])

    per_sku = []
    for sku, rows in sku_rows.items():
        s = summarize(rows)
        p = by_sku[sku]
        per_sku.append({
            "id": p["id"],
            "sku": sku,
            "name": p["name"],
            "n": s["n"],
            "actualTotal": s["actualTotal"],
            "forecastTotal": s["forecastTotal"],
            "wape": s["model"]["wape"],
            "bias": s["model"]["bias"],
            "baselineWape": s["baseline"]["wape"],
            "beatsBaseline": (
                s["model"]["wape"] < s["baseline"]["wape"]
                if s["model"]["wape"] is not None and s["baseline"]["wape"] is not None
                else None
            ),
        })
    per_sku.sort(key=lambda r: r["sku"])
    result["perSku"] = per_sku
    return result
