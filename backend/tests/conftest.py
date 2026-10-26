from collections.abc import Callable, Sequence
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import data
from main import app

LONDON = ZoneInfo("Europe/London")
# Nominal WINDFOR publish times (UTC), as observed in January 2026.
RUN_TIMES = tuple(time(h, 30) for h in (2, 4, 7, 9, 11, 15, 18, 22))

# Vectorised value functions: they get Series of UTC timestamps and return an array or a scalar.
ForecastFn = Callable[[pd.Series, pd.Series], np.ndarray | float]  # (startTime, publishTime) -> MW
ActualFn = Callable[[pd.Series], np.ndarray | float]  # (startTime) -> MW


def _epoch_s(s: pd.Series) -> list[int]:
    return ((s - pd.Timestamp(0, tz="UTC")) // pd.Timedelta(seconds=1)).tolist()


def _frame(publish: pd.Series, start: pd.Series, gen: np.ndarray | float) -> pd.DataFrame:
    # Same dtypes as data.load_snapshot(), so analysis code cannot tell synthetic data from the snapshot.
    return data._from_columns(
        {
            "publishTime": _epoch_s(publish),
            "startTime": _epoch_s(start),
            "generation": np.broadcast_to(np.asarray(gen, dtype=float), len(start)).tolist(),
        }
    )


def synth_data(
    days: Sequence[date],
    forecast: ForecastFn | float = 10_000.0,
    actual: ActualFn | float = 9_000.0,
    run_times: Sequence[time] = RUN_TIMES,
    fuel_lag: timedelta = timedelta(minutes=30),
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Synthetic (windfor, fuelhh) frames shaped like the snapshot, for the delivery `days`.

    WINDFOR: runs on every publish day from min(days) - 2 to max(days) - 1 at `run_times` (UTC), each with
    73 hourly points from 21:00 UTC the day before publish to 21:00 UTC two days after, hindcast included.
    FUELHH: half-hours for the London days min(days) - 2 .. max(days), published `fuel_lag` after start.
    """
    first, last = min(days), max(days)
    pub_days = pd.date_range(first - timedelta(2), last - timedelta(1), freq="D", tz="UTC")
    publish = pd.DatetimeIndex(
        [d + pd.Timedelta(hours=t.hour, minutes=t.minute) for d in pub_days for t in run_times]
    )
    offsets = pd.to_timedelta(np.arange(73), unit="h")
    wf_pub = pd.Series(np.repeat(publish, 73))
    wf_start = pd.Series([p.normalize() - pd.Timedelta(hours=3) + o for p in publish for o in offsets])
    wf_gen = forecast(wf_start, wf_pub) if callable(forecast) else forecast
    windfor = _frame(wf_pub, wf_start, wf_gen).sort_values(["publishTime", "startTime"], ignore_index=True)

    lo = datetime.combine(first - timedelta(2), time(0), tzinfo=LONDON)
    hi = datetime.combine(last + timedelta(1), time(0), tzinfo=LONDON)
    fh_start = pd.Series(pd.date_range(lo, hi, freq="30min", inclusive="left").tz_convert("UTC"))
    fh_gen = actual(fh_start) if callable(actual) else actual
    fuelhh = _frame(fh_start + fuel_lag, fh_start, fh_gen)
    return windfor, fuelhh


@pytest.fixture(scope="session")
def snapshot() -> data.Data:
    return data.load_snapshot()


@pytest.fixture(scope="session")
def client() -> TestClient:
    # Not used as a context manager, so the lifespan (live Elexon verification) never runs in tests.
    return TestClient(app)
