"""Fetch the Elexon ranges used by the app and write backend/data/snapshot.json.gz.

Run: uv run --project backend python scripts/refresh_snapshot.py
Never runs at request time; the API only reads the snapshot (and verifies it live).
"""

import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

import pandas as pd  # noqa: E402

from app.data import (  # noqa: E402
    FUELHH_RANGE,
    SNAPSHOT_PATH,
    WINDFOR_RANGE,
    fetch_fuelhh,
    fetch_windfor,
    normalise,
    write_snapshot,
)


def sanity(wf: pd.DataFrame, fh: pd.DataFrame) -> None:
    assert not wf.duplicated(["publishTime", "startTime"]).any(), "WINDFOR duplicates"
    assert not fh.duplicated("startTime").any(), "FUELHH duplicates"
    runs = wf.groupby(wf.publishTime.dt.date).publishTime.nunique()
    odd = runs[runs != 8]
    print(f"WINDFOR runs/day: modal 8, days off-pattern: {dict(odd)}")
    hh = fh.groupby(fh.startTime.dt.tz_convert("Europe/London").dt.date).size()
    print(f"FUELHH half-hours/day: {hh.value_counts().to_dict()}")
    full = pd.date_range(fh.startTime.min(), fh.startTime.max(), freq="30min")
    missing = full.difference(fh.startTime)
    assert len(missing) == 0, f"FUELHH missing half-hours: {list(missing[:10])}"


def main() -> None:
    fetched_at = datetime.now(UTC).isoformat(timespec="seconds")
    wf, fh = normalise(fetch_windfor(*WINDFOR_RANGE), fetch_fuelhh(*FUELHH_RANGE))
    sanity(wf, fh)
    h = write_snapshot(SNAPSHOT_PATH, wf, fh, fetched_at)
    size = SNAPSHOT_PATH.stat().st_size
    print(f"wrote {SNAPSHOT_PATH} ({size / 1024:.0f} KB) hash={h} windfor={len(wf)} fuelhh={len(fh)}")


if __name__ == "__main__":
    main()
