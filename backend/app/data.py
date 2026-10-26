"""Elexon data access: bundled snapshot (primary), live verification, live inputs for the Tomorrow tab.

The snapshot is the source of truth for the January 2026 pilot. Historic Elexon data does not
change, so a live fetch adds no information; it is only used to *verify* the snapshot and to
power the Tomorrow (live) tab.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger("firmwind.data")

BASE = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
SNAPSHOT_PATH = Path(__file__).parent.parent / "data" / "snapshot.json.gz"

# WINDFOR filtered by publishTime; FUELHH by settlementDate (UK local day). Ranges include
# December 2025 so the optional "Include December history" calibration works.
WINDFOR_RANGE = (datetime(2025, 11, 30, tzinfo=UTC), datetime(2026, 2, 1, tzinfo=UTC))
FUELHH_RANGE = (date(2025, 12, 1), date(2026, 2, 1))
CHUNK_DAYS = 7


@dataclass(frozen=True)
class Data:
    windfor: pd.DataFrame  # publishTime, startTime (UTC), generation (MW float)
    fuelhh: pd.DataFrame  # publishTime, startTime (UTC), generation (MW float)
    hash: str
    fetched_at: str


# ---------------------------------------------------------------- fetch


def _http_get(url: str, timeout: float = 30) -> bytes:
    """GET with two retries on 429/5xx/network errors."""
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "firmwind/0.1"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500 or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("unreachable")


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _get_all(urls: list[str], timeout: float) -> list[dict]:
    """Fetch chunks concurrently (order preserved): a serverless request can afford ~5 s, not ~30 s."""
    with ThreadPoolExecutor(max_workers=8) as pool:
        bodies = pool.map(lambda u: _http_get(u, timeout), urls)
        return [row for body in bodies for row in json.loads(body)]


def fetch_windfor(start: datetime, end: datetime, timeout: float = 30) -> list[dict]:
    urls: list[str] = []
    t = start
    while t < end:
        e = min(t + timedelta(days=CHUNK_DAYS), end)
        urls.append(f"{BASE}/WINDFOR/stream?publishDateTimeFrom={_iso(t)}&publishDateTimeTo={_iso(e)}")
        t = e
    return _get_all(urls, timeout)


def fetch_fuelhh(start: date, end: date, timeout: float = 30) -> list[dict]:
    urls: list[str] = []
    d = start
    while d <= end:
        e = min(d + timedelta(days=CHUNK_DAYS - 1), end)
        urls.append(f"{BASE}/FUELHH/stream?settlementDateFrom={d}&settlementDateTo={e}&fuelType=WIND")
        d = e + timedelta(days=1)
    return _get_all(urls, timeout)


# ---------------------------------------------------------------- normalise + hash


def _frame(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["publishTime", "startTime", "generation"])
    return pd.DataFrame(
        {
            "publishTime": pd.to_datetime(df["publishTime"], utc=True),
            "startTime": pd.to_datetime(df["startTime"], utc=True),
            "generation": pd.to_numeric(df["generation"]).astype(float),
        }
    )


def normalise(wf_rows: list[dict], fh_rows: list[dict]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Cast to typed frames, dedupe, sort. Hindcast rows are kept here; analysis drops them."""
    wf = (
        _frame(wf_rows)
        .drop_duplicates(["publishTime", "startTime"], keep="last")
        .sort_values(["publishTime", "startTime"])
        .reset_index(drop=True)
    )
    fh = (
        _frame(fh_rows)
        .sort_values("publishTime")
        .drop_duplicates("startTime", keep="last")
        .sort_values("startTime")
        .reset_index(drop=True)
    )
    return wf, fh


def _epoch(s: pd.Series) -> np.ndarray:
    return (s.astype("datetime64[s, UTC]").astype("int64")).to_numpy()


def _columns(df: pd.DataFrame) -> dict[str, list[int]]:
    return {
        "publishTime": _epoch(df["publishTime"]).tolist(),
        "startTime": _epoch(df["startTime"]).tolist(),
        "generation": np.rint(df["generation"].to_numpy()).astype(int).tolist(),
    }


def data_hash(wf: pd.DataFrame, fh: pd.DataFrame) -> str:
    """Hash of normalised values (not file bytes), so live and snapshot compare like for like."""
    payload = json.dumps({"windfor": _columns(wf), "fuelhh": _columns(fh)}, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()[:12]


def _from_columns(c: dict[str, list[int]]) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "publishTime": pd.to_datetime(c["publishTime"], unit="s", utc=True),
            "startTime": pd.to_datetime(c["startTime"], unit="s", utc=True),
            "generation": np.asarray(c["generation"], dtype=float),
        }
    )


def write_snapshot(path: Path, wf: pd.DataFrame, fh: pd.DataFrame, fetched_at: str) -> str:
    h = data_hash(wf, fh)
    doc = {
        "meta": {
            "fetched_at": fetched_at,
            "windfor_publish": [_iso(WINDFOR_RANGE[0]), _iso(WINDFOR_RANGE[1])],
            "fuelhh_settlement": [str(FUELHH_RANGE[0]), str(FUELHH_RANGE[1])],
            "hash": h,
            "rows": {"windfor": len(wf), "fuelhh": len(fh)},
        },
        "windfor": _columns(wf),
        "fuelhh": _columns(fh),
    }
    raw = json.dumps(doc, separators=(",", ":")).encode()
    path.write_bytes(gzip.compress(raw, mtime=0))
    return h


@lru_cache(maxsize=1)
def load_snapshot() -> Data:
    doc = json.loads(gzip.decompress(SNAPSHOT_PATH.read_bytes()))
    wf, fh = _from_columns(doc["windfor"]), _from_columns(doc["fuelhh"])
    h = data_hash(wf, fh)
    if h != doc["meta"]["hash"]:
        raise RuntimeError(f"snapshot hash mismatch: {h} != {doc['meta']['hash']}")
    return Data(wf, fh, h, doc["meta"]["fetched_at"])


# ---------------------------------------------------------------- live verification

_lock = threading.Lock()
SOURCE: dict = {"state": "checking", "checked_at": None}
_verify_started = False


def source_status() -> dict:
    with _lock:
        return dict(SOURCE)


def _set_source(state: str) -> None:
    with _lock:
        SOURCE.update(state=state, checked_at=datetime.now(UTC).isoformat())


def verify_now(timeout: float = 20) -> str:
    """Refetch the snapshot ranges and compare hashes. Never raises."""
    snap = load_snapshot()
    try:
        wf, fh = normalise(
            fetch_windfor(*WINDFOR_RANGE, timeout=timeout), fetch_fuelhh(*FUELHH_RANGE, timeout=timeout)
        )
        live_hash = data_hash(wf, fh)
    except Exception as e:  # network, JSON, schema drift: all mean "can't verify"
        log.warning("live verify failed: %s", e)
        _set_source("unreachable")
        return "unreachable"
    state = "verified" if live_hash == snap.hash else "changed"
    if state == "changed":
        log.warning("Elexon data differs from snapshot: live=%s snapshot=%s", live_hash, snap.hash)
    _set_source(state)
    return state


_verify_lock = threading.Lock()
VERIFY_MAX_AGE_S = 3600


def verify_once(max_age_s: float = VERIFY_MAX_AGE_S) -> dict:
    """Return the source status, verifying synchronously if no recent result exists.

    Serverless platforms freeze a function once its response is sent, so a background thread may
    never finish there; the /source route calls this inline instead (the CDN absorbs repeats).
    """
    with _verify_lock:
        st = source_status()
        if st["checked_at"] is not None:
            age = (datetime.now(UTC) - datetime.fromisoformat(st["checked_at"])).total_seconds()
            if age < max_age_s:
                return st
        verify_now()
        return source_status()


def start_verify() -> None:
    """Kick off one background verification per process (completes on long-lived servers)."""
    global _verify_started
    with _lock:
        if _verify_started:
            return
        _verify_started = True
    threading.Thread(target=verify_once, daemon=True, name="snapshot-verify").start()


# ---------------------------------------------------------------- live inputs (Tomorrow tab)

LIVE_TTL_S = 30 * 60
LIVE_FAIL_TTL_S = 60
_live_cache: dict = {"at": 0.0, "value": None, "error": None}


def live_inputs(
    now: datetime | None = None, fresh_from: datetime | None = None
) -> tuple[pd.DataFrame, pd.DataFrame, str]:
    """Trailing ~33 days of WINDFOR + FUELHH for the live section. Cached; failures negative-cached.

    A cached fetch older than `fresh_from` is refetched. Returns (windfor, fuelhh, fetched_at).
    Raises RuntimeError when Elexon is unavailable.
    """
    now = now or datetime.now(UTC)
    age = time.monotonic() - _live_cache["at"]
    cached = _live_cache["value"]
    fresh = cached is not None and (fresh_from is None or datetime.fromisoformat(cached[2]) >= fresh_from)
    if fresh and age < LIVE_TTL_S:
        return cached
    if _live_cache["error"] is not None and age < LIVE_FAIL_TTL_S:
        raise RuntimeError(_live_cache["error"])
    try:
        start = (now - timedelta(days=33)).replace(minute=0, second=0, microsecond=0)
        wf, fh = normalise(
            fetch_windfor(start, now + timedelta(hours=1)),
            fetch_fuelhh((now - timedelta(days=32)).date(), now.date()),
        )
    except Exception as e:
        log.warning("live fetch failed: %s", e)
        _live_cache.update(at=time.monotonic(), value=None, error=str(e))
        raise RuntimeError(f"Elexon unavailable: {e}") from e
    value = (wf, fh, now.isoformat())
    _live_cache.update(at=time.monotonic(), value=value, error=None)
    return value
