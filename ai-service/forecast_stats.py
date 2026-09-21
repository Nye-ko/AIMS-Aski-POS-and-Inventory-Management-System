"""Level and range statistics for the forecast engine.

Pure, deterministic and plain left-to-right float arithmetic, so backend/services/forecastStats.js can
reproduce every number exactly (tied together by the golden fixture in tests/fixtures).

A series is a list of daily amounts ending on the last complete day. An entry is None when the day must
not be learned from (the product was out of stock, so a zero there says nothing about demand).
"""
import math

INTERVAL_Z = 1.2816        # 80% central range under a normal approximation
SERVICE_Z = 1.6449         # one-sided 95%: safety stock covers demand 19 times out of 20
VARIANCE_WINDOW_DAYS = 28  # recent days used to measure how much daily sales bounce around


def window_mean(vals, days):
    """(mean, count) of the observed entries among the last `days`; None when there are none."""
    total = 0.0
    n = 0
    for v in vals[-days:]:
        if v is not None:
            total += v
            n += 1
    return (total / n, n) if n else None


def sample_variance(vals, days=VARIANCE_WINDOW_DAYS):
    """Sample variance of the observed entries among the last `days`; None with fewer than two."""
    seen = [v for v in vals[-days:] if v is not None]
    if len(seen) < 2:
        return None
    total = 0.0
    for v in seen:
        total += v
    mean = total / len(seen)
    acc = 0.0
    for v in seen:
        acc += (v - mean) * (v - mean)
    return acc / (len(seen) - 1)


def total_sd(rate, level_days, variance, days, count_data=False):
    """Standard deviation of the total sold over `days` days at `rate` per day.

    Day-to-day noise adds up with the number of days; the error in the rate itself (estimated from
    `level_days` days) grows with the square of the number of days, so long horizons get wide, honestly.
    count_data=True is for unit sales: counts are never less noisy than Poisson, so the variance is at
    least the rate.
    """
    v = variance if variance is not None else (rate if count_data else 0.0)
    if count_data and rate > v:
        v = rate
    return math.sqrt(days * v + days * days * v / level_days)


def range_for_total(rate, level_days, variance, days, count_data=False):
    """(low, high): 80% range for the total over `days` days at `rate` per day."""
    sd = total_sd(rate, level_days, variance, days, count_data)
    total = rate * days
    return max(0.0, total - INTERVAL_Z * sd), total + INTERVAL_Z * sd
