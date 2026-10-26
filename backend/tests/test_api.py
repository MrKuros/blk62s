"""HTTP contract: every route against the real snapshot, error bodies, cache headers, CSV receipt."""

import csv
import io
from datetime import UTC, datetime, timedelta

import numpy as np
import pytest
from conftest import synth_data
from fastapi.testclient import TestClient

import main
from app import analysis as A
from app import data, schemas, service

DAY = "2026-01-12"
STATIC_CDN = "s-maxage=86400, stale-while-revalidate=604800"


def get(client, path: str, **params):
    return client.get(f"/api/v1/{path}", params=params)


@pytest.mark.parametrize(
    ("path", "params", "model"),
    [
        ("meta", {}, schemas.Meta),
        ("replay", {"day": DAY}, schemas.Replay),
        ("replay", {"day": "2026-02-01", "cutoff": "00:00", "margin": 20, "calib": "dec"}, schemas.Replay),
        ("accuracy", {"cutoff": "n2ex", "margin": 10}, schemas.Accuracy),
        ("firm", {"calib": "dec", "v": "a1ce1e48b9bb"}, schemas.Firm),
        ("waiting", {}, schemas.Waiting),
        ("health", {}, schemas.Health),
    ],
)
def test_routes_serve_their_model(client, path, params, model):
    r = get(client, path, **params)
    assert r.status_code == 200, r.text
    body = model.model_validate(r.json())
    assert body.data_hash == data.load_snapshot().hash


def test_replay_uses_the_run_before_each_gate(client):
    epex = get(client, "replay", day=DAY).json()
    n2ex = get(client, "replay", day=DAY, cutoff="n2ex").json()
    assert epex["decision_run"]["publish_time"] == "2026-01-11T07:30:00Z"
    assert n2ex["decision_run"]["publish_time"] == "2026-01-11T09:30:00Z"
    assert epex["params"] == {
        "cutoff": "epex",
        "cutoff_local": "09:20",
        "margin": 0,
        "calib": "jan",
        "day": DAY,
    }
    assert len(epex["hours"]) == 24 and all(len(x["values"]) == 24 for x in epex["runs"])
    late = {x["publish_time"] for x in epex["runs"] if x["too_late"]}
    assert "2026-01-11T09:30:00Z" in late and "2026-01-11T07:30:00Z" not in late
    assert epex["signal"]["id"] == "above_ceiling"


def test_28_jan_flags_the_frozen_feed(client):
    for cutoff in ("epex", "n2ex"):
        sig = get(client, "replay", day="2026-01-28", cutoff=cutoff).json()["signal"]
        assert sig["id"] == "run_jump" and sig["params"]["since"] == "2026-01-26T18:30:00Z"


def test_calibrating_day_has_no_correction(client):
    r = get(client, "replay", day="2026-01-02").json()
    assert r["calibration"]["status"] == "calibrating" and r["calibration"]["q"] is None
    assert r["kpis"]["correction_avg_mw"] is None
    assert all(h["raw"] == h["corrected"] for h in r["hours"])


def test_waiting_gates(client):
    w = get(client, "waiting").json()
    assert {g["auction"]: g["last_slot_id"] for g in w["gates"]} == {"epex": "d1_0730", "n2ex": "d1_0930"}
    post = {s["id"]: s["post_gate"] for s in w["slots"]}
    assert post["d1_0730"] == {"epex": False, "n2ex": False}
    assert post["d1_0930"] == {"epex": True, "n2ex": False}
    assert all(s["n_hours"] == w["common_hours"] for s in w["slots"])


@pytest.mark.parametrize(
    ("path", "params", "field"),
    [
        ("replay", {"day": "2026-02-15"}, "day"),
        ("replay", {"day": "not-a-date"}, "day"),
        ("replay", {}, "day"),
        ("accuracy", {"cutoff": "09:60"}, "cutoff"),
        ("accuracy", {"cutoff": "noon"}, "cutoff"),
        ("firm", {"margin": 5}, "margin"),
        ("firm", {"margin": 70}, "margin"),
        ("accuracy", {"calib": "nov"}, "calib"),
        ("live", {"cutoff": "24:00"}, "cutoff"),
        ("export.csv", {"view": "replay"}, "day"),
        ("export.csv", {"view": "replay", "day": "2025-12-15"}, "day"),
        ("export.csv", {"view": "pdf"}, "view"),
    ],
)
def test_bad_params_get_422_error_body(client, path, params, field):
    r = get(client, path, **params)
    assert r.status_code == 422
    err = schemas.ErrorBody.model_validate(r.json()).error
    assert err.code == "invalid_param" and err.field == field and err.message
    assert "Vercel-CDN-Cache-Control" not in r.headers  # an error must never sit in the CDN for a day


@pytest.mark.parametrize(
    "path", ["replay?day=2026-01-12", "accuracy", "firm", "waiting", "export.csv?view=firm"]
)
def test_january_views_are_cached_long(client, path):
    r = client.get(f"/api/v1/{path}")
    assert r.headers["Cache-Control"] == "public, max-age=300"
    assert r.headers["Vercel-CDN-Cache-Control"] == STATIC_CDN


@pytest.mark.parametrize(
    ("state", "ttl"), [("checking", 30), ("verified", 300), ("changed", 300), ("unreachable", 60)]
)
def test_meta_ttl_follows_source_state(client, monkeypatch, state, ttl):
    monkeypatch.setitem(data.SOURCE, "state", state)
    r = get(client, "meta")
    assert r.json()["source"]["state"] == state
    assert r.headers["Vercel-CDN-Cache-Control"] == f"s-maxage={ttl}"
    assert "max-age=0" in r.headers["Cache-Control"]


def test_health_is_not_cached(client):
    assert get(client, "health").headers["Cache-Control"] == "no-store"


def test_meta_lists_the_pilot(client):
    m = get(client, "meta").json()
    assert m["days"] == [str(d) for d in A.DAYS] and len(m["slots"]) == 16
    assert [(a["id"], a["local_time"]) for a in m["auctions"]] == [("epex", "09:20"), ("n2ex", "09:50")]


# ---------------------------------------------------------------- CSV


def read_csv(text: str) -> tuple[list[str], list[str], list[list[str]]]:
    lines = text.splitlines()
    receipt = [x for x in lines if x.startswith("#")]
    header, *rows = csv.reader(io.StringIO("\n".join(lines[len(receipt) :])))
    return receipt, header, rows


@pytest.mark.parametrize(
    ("view", "n_rows"), [("replay", 24), ("accuracy", 31), ("firm", 744), ("waiting", 16)]
)
def test_csv_export_has_receipt_then_header(client, view, n_rows):
    r = get(client, "export.csv", view=view, day=DAY, cutoff="n2ex", margin=10)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    receipt, header, rows = read_csv(r.text)
    assert receipt[0].startswith(f"# view={view} cutoff=")
    assert f"data_hash={data.load_snapshot().hash}" in receipt[2] and "version=" in receipt[2]
    assert len(rows) == n_rows and all(len(x) == len(header) for x in rows)


def test_replay_csv_receipt_names_the_run(client):
    receipt, header, rows = read_csv(get(client, "export.csv", view="replay", day=DAY).text)
    assert receipt[0] == f"# view=replay cutoff=epex (09:20 Europe/London, D-1) margin=0 calib=jan day={DAY}"
    assert receipt[1] == "# run_used=2026-01-11T07:30:00+00:00"
    assert header[:4] == ["hour_start_utc", "raw_mw", "corrected_mw", "actual_mw"]
    raw, firm10, firm5 = (float(rows[0][header.index(k)]) for k in ("raw_mw", "firm_r10_mw", "firm_r5_mw"))
    assert 0 < firm5 < firm10 < raw


# ---------------------------------------------------------------- live


def fake_live(now: datetime):
    """Trailing-month synthetic Elexon data around `now`, shaped like the real feed."""
    target = A.live_target_day(now)
    days = [target - timedelta(days=i) for i in range(32, -1, -1)]
    rng = np.random.default_rng(3)
    noise = rng.normal(0, 400, 24 * 50)
    t0 = (now - timedelta(days=40)).replace(minute=0, second=0, microsecond=0)

    def actual(s):
        return 7_000 + 80 * s.dt.hour.to_numpy() + noise[((s - t0).dt.total_seconds() // 3600).astype(int)]

    wf, fh = synth_data(days, forecast=lambda s, p: 8_000.0 + 100 * s.dt.hour.to_numpy(), actual=actual)
    return wf[wf.publishTime < now], fh[fh.publishTime < now], now.isoformat()


def test_live_view_runs_the_pilot_pipeline(monkeypatch):
    now = datetime(2026, 10, 26, 8, 0, tzinfo=UTC)  # first GMT day after the clock change; gate at 09:20 UTC
    seen = []

    def inputs(now=None, fresh_from=None):
        seen.append(fresh_from)
        return fake_live(now)

    monkeypatch.setattr(data, "live_inputs", inputs)
    v = service.live_view("epex", 0, now)
    assert v.status == "ok" and v.target_day.isoformat() == "2026-10-27"
    assert not v.gate_passed and v.cutoff_utc.isoformat() == "2026-10-26T09:20:00+00:00"
    assert v.decision_run.publish_time.isoformat() == "2026-10-26T07:30:00+00:00"  # latest so far
    assert len(v.hours) == 24 and all(h.raw is not None for h in v.hours)
    cal = v.calibration
    assert cal.status == "ok" and cal.train_days == 30 and cal.train_window[1].isoformat() == "2026-10-25"
    assert all(h.corrected < h.raw for h in v.hours)  # it learned the synthetic over-forecast

    later = service.live_view("n2ex", 10, now + timedelta(hours=2))
    assert later.gate_passed and later.decision_run.publish_time.isoformat() == "2026-10-26T09:30:00+00:00"
    # Before the gate any cached fetch will do; after it, only one made after the gate.
    assert seen == [None, later.cutoff_utc]


def test_live_route_degrades_to_unavailable(client, monkeypatch):
    def down(now=None, fresh_from=None):
        raise RuntimeError("Elexon unavailable: timed out")

    monkeypatch.setattr(data, "live_inputs", down)
    r = get(client, "live", cutoff="n2ex")
    assert r.status_code == 200
    body = schemas.Live.model_validate(r.json())
    assert body.status == "unavailable" and body.hours == [] and body.message
    assert r.headers["Vercel-CDN-Cache-Control"] == "s-maxage=60"


def test_live_route_ok_is_cached_until_it_can_change(client, monkeypatch):
    monkeypatch.setattr(data, "live_inputs", lambda now=None, **_: fake_live(now or datetime.now(UTC)))
    r = get(client, "live")
    assert r.json()["status"] == "ok", r.json().get("message")
    assert 1 <= int(r.headers["Vercel-CDN-Cache-Control"].removeprefix("s-maxage=")) <= 1800


@pytest.mark.parametrize(
    ("now", "fetched_min_ago", "ttl"),
    [
        (datetime(2026, 1, 12, 8, 0, tzinfo=UTC), 0, 1800),  # quiet morning: the 30 min cap
        (datetime(2026, 1, 12, 9, 10, tzinfo=UTC), 0, 600),  # until the EPEX gate at 09:20
        (datetime(2026, 1, 12, 9, 10, tzinfo=UTC), 25, 300),  # until the data cache expires
        (datetime(2026, 1, 12, 23, 50, tzinfo=UTC), 0, 600),  # until London midnight: a new tomorrow
        (datetime(2026, 7, 12, 22, 50, tzinfo=UTC), 0, 600),  # same, in BST
    ],
)
def test_live_cdn_ttl_stops_at_the_next_change(monkeypatch, now, fetched_min_ago, ttl):
    fetched = (now - timedelta(minutes=fetched_min_ago)).isoformat()
    monkeypatch.setattr(data, "live_inputs", lambda now=None, **_: (*fake_live(now)[:2], fetched))
    out = service.live_view("epex", 0, now)
    assert out.status == "ok", out.message
    assert main._live_ttl(out, now) == ttl


def test_server_bugs_are_500_not_param_errors(monkeypatch):
    def broken(*_):
        raise ValueError("cannot convert float NaN to integer")

    monkeypatch.setattr(service, "accuracy_view", broken)
    r = TestClient(main.app, raise_server_exceptions=False).get("/api/v1/accuracy")
    assert r.status_code == 500 and "NaN" not in r.text


def test_accuracy_without_a_d2_run_has_null_baseline(client):
    # At 00:30 minus 20 min no run exists yet on D-2 for the D-2 baseline to use.
    r = get(client, "accuracy", cutoff="00:30", margin=20)
    assert r.status_code == 200, r.text
    b = r.json()["baselines"]
    assert b["d2_mae"] is None and b["d2_n_hours"] == 0


# ---------------------------------------------------------------- docs


def test_docs_and_openapi_are_served(client):
    assert client.get("/api/docs").status_code == 200
    spec = client.get("/api/openapi.json").json()
    assert {"/api/v1/replay", "/api/v1/live", "/api/v1/export.csv"} <= set(spec["paths"])
