"""Data layer: snapshot integrity and the degraded paths of live verification and live inputs.

No test touches the network: app.data._http_get is replaced by a fake Elexon serving the snapshot.
"""

import gzip
import json
import urllib.error
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pandas as pd
import pytest

from app import data

SNAPSHOT_HASH = "a1ce1e48b9bb"


def iso(s: pd.Series) -> list[str]:
    return s.dt.strftime("%Y-%m-%dT%H:%M:%SZ").tolist()


class FakeElexon:
    """Answers the two stream endpoints from the snapshot, filtered like the real API."""

    def __init__(self, snap: data.Data, bump: int = 0, fail: Exception | None = None):
        self.wf, self.fh, self.bump, self.fail, self.calls = snap.windfor, snap.fuelhh, bump, fail, 0

    def __call__(self, url: str, timeout: float = 30) -> bytes:
        self.calls += 1
        if self.fail:
            raise self.fail
        q = {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}
        if "/WINDFOR/" in url:
            lo, hi = pd.Timestamp(q["publishDateTimeFrom"]), pd.Timestamp(q["publishDateTimeTo"])
            rows = self.wf[self.wf.publishTime.between(lo, hi)]
        else:
            day = self.fh.startTime.dt.tz_convert("Europe/London").dt.date.astype(str)
            rows = self.fh[day.between(q["settlementDateFrom"], q["settlementDateTo"])]
        gen = rows.generation.astype(int).tolist()
        if self.bump and gen:
            gen[0] += self.bump
        out = [
            {"publishTime": p, "startTime": s, "generation": g}
            for p, s, g in zip(iso(rows.publishTime), iso(rows.startTime), gen, strict=True)
        ]
        return json.dumps(out).encode()


@pytest.fixture
def source(monkeypatch):
    monkeypatch.setattr(data, "SOURCE", {"state": "checking", "checked_at": None})


@pytest.fixture
def clock(monkeypatch):
    now = SimpleNamespace(t=10_000.0)
    monkeypatch.setattr(data, "time", SimpleNamespace(monotonic=lambda: now.t, sleep=lambda s: None))
    monkeypatch.setattr(data, "_live_cache", {"at": 0.0, "value": None, "error": None})
    return now


def test_snapshot_hash_and_shape(snapshot):
    assert snapshot.hash == SNAPSHOT_HASH
    assert (len(snapshot.windfor), len(snapshot.fuelhh)) == (36_792, 3_024)
    assert data.data_hash(snapshot.windfor, snapshot.fuelhh) == SNAPSHOT_HASH
    for df in (snapshot.windfor, snapshot.fuelhh):
        assert str(df.publishTime.dt.tz) == "UTC" and df.generation.dtype == float


def test_snapshot_round_trips(snapshot, tmp_path):
    path = tmp_path / "snap.json.gz"
    assert data.write_snapshot(path, snapshot.windfor, snapshot.fuelhh, "x") == SNAPSHOT_HASH
    first = path.read_bytes()
    data.write_snapshot(path, snapshot.windfor, snapshot.fuelhh, "x")
    assert path.read_bytes() == first  # byte-for-byte deterministic
    doc = json.loads(gzip.decompress(first))
    wf, fh = data._from_columns(doc["windfor"]), data._from_columns(doc["fuelhh"])
    assert data.data_hash(wf, fh) == doc["meta"]["hash"] == SNAPSHOT_HASH


def test_normalise_dedupes_and_casts():
    rows = [
        {"publishTime": "2026-01-01T07:30:00Z", "startTime": "2026-01-02T00:00:00Z", "generation": "100"},
        {"publishTime": "2026-01-01T07:30:00Z", "startTime": "2026-01-02T00:00:00Z", "generation": "120"},
    ]
    fh = [
        {"publishTime": "2026-01-02T00:30:00Z", "startTime": "2026-01-02T00:00:00Z", "generation": "90"},
        {"publishTime": "2026-01-02T03:00:00Z", "startTime": "2026-01-02T00:00:00Z", "generation": "95"},
    ]
    wf_df, fh_df = data.normalise(rows, fh)
    assert wf_df.generation.tolist() == [120.0]  # last duplicate wins
    assert fh_df.generation.tolist() == [95.0]  # latest publish wins


def test_verify_matches_snapshot(snapshot, source, monkeypatch):
    fake = FakeElexon(snapshot)
    monkeypatch.setattr(data, "_http_get", fake)
    assert data.verify_now() == "verified"
    assert data.source_status()["state"] == "verified" and data.source_status()["checked_at"]
    assert fake.calls > 2  # chunked requests


def test_verify_detects_changed_data(snapshot, source, monkeypatch):
    monkeypatch.setattr(data, "_http_get", FakeElexon(snapshot, bump=1))
    assert data.verify_now() == "changed"
    assert data.source_status()["state"] == "changed"


@pytest.mark.parametrize(
    "error", [urllib.error.URLError("dns"), TimeoutError(), ValueError("bad json"), KeyError("generation")]
)
def test_verify_unreachable_never_raises(snapshot, source, monkeypatch, error):
    monkeypatch.setattr(data, "_http_get", FakeElexon(snapshot, fail=error))
    assert data.verify_now() == "unreachable"
    assert data.source_status()["state"] == "unreachable"


def test_http_get_retries_server_errors_then_gives_up(monkeypatch):
    calls = []

    def urlopen(req, timeout):
        calls.append(req.full_url)
        raise urllib.error.HTTPError(req.full_url, 503, "busy", {}, None)

    monkeypatch.setattr(data.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(data, "time", SimpleNamespace(sleep=lambda s: None))
    with pytest.raises(urllib.error.HTTPError):
        data._http_get("https://example.invalid/x")
    assert len(calls) == 3


def test_http_get_does_not_retry_client_errors(monkeypatch):
    calls = []

    def urlopen(req, timeout):
        calls.append(1)
        raise urllib.error.HTTPError(req.full_url, 400, "bad", {}, None)

    monkeypatch.setattr(data.urllib.request, "urlopen", urlopen)
    with pytest.raises(urllib.error.HTTPError):
        data._http_get("https://example.invalid/x")
    assert len(calls) == 1


NOW = datetime(2026, 1, 20, 10, 0, tzinfo=UTC)


def test_live_inputs_cached_for_ttl(snapshot, clock, monkeypatch):
    fake = FakeElexon(snapshot)
    monkeypatch.setattr(data, "_http_get", fake)
    wf, fh, fetched_at = data.live_inputs(NOW)
    assert fetched_at == NOW.isoformat() and len(wf) and len(fh)
    assert wf.publishTime.max() < NOW + pd.Timedelta(hours=1)
    first = fake.calls
    clock.t += data.LIVE_TTL_S - 1
    assert data.live_inputs(NOW)[2] == fetched_at and fake.calls == first
    clock.t += 2
    data.live_inputs(NOW)
    assert fake.calls == 2 * first


def test_live_inputs_refetch_when_older_than_fresh_from(snapshot, clock, monkeypatch):
    # live_view passes the gate: a fetch from before it may not hold the run the gate used.
    fake = FakeElexon(snapshot)
    monkeypatch.setattr(data, "_http_get", fake)
    data.live_inputs(NOW)
    first = fake.calls
    later = NOW + timedelta(minutes=5)
    assert data.live_inputs(later, fresh_from=NOW)[2] == NOW.isoformat() and fake.calls == first
    assert data.live_inputs(later, fresh_from=later)[2] == later.isoformat() and fake.calls == 2 * first


def test_live_inputs_negative_cache(snapshot, clock, monkeypatch):
    fake = FakeElexon(snapshot, fail=urllib.error.URLError("down"))
    monkeypatch.setattr(data, "_http_get", fake)
    with pytest.raises(RuntimeError, match="Elexon unavailable"):
        data.live_inputs(NOW)
    assert fake.calls == 1
    clock.t += data.LIVE_FAIL_TTL_S - 1
    with pytest.raises(RuntimeError):
        data.live_inputs(NOW)
    assert fake.calls == 1  # failure served from the negative cache
    clock.t += 2
    fake.fail = None
    assert len(data.live_inputs(NOW)[0])
    assert fake.calls > 1
