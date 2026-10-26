# How to run (from the repo root, after fetch.py has filled raw/):
#   uv run --project backend python -I docs/research/exploratory/jan_analysis.py > out.md
# Needs pandas + numpy (the backend environment has both). Prints markdown tables to stdout.
"""Exploratory January 2026 WINDFOR vs FUELHH WIND analysis (pre-build; 09:50 gate, leave-one-day-out).

Reads the cached JSON from raw/ next to this script. The app's final method differs (EPEX 09:20 default,
walk-forward validation); see docs/research/final-numbers.md.
"""

import glob
import json
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
H = pd.Timedelta(hours=1)
GATE = pd.Timedelta(hours=9, minutes=50)  # D-1 09:50 UK == UTC in January


def load(prefix):
    rows = []
    for path in sorted(glob.glob(f"{RAW}/{prefix}_*.json")):
        with open(path) as f:
            rows.extend(json.load(f))
    return pd.DataFrame(rows)


def md(df, floatfmt="{:.0f}"):
    df = df.copy()
    for c in df.columns:
        if df[c].dtype.kind == "f":
            df[c] = df[c].map(lambda v: "" if pd.isna(v) else floatfmt.format(v))
    cols = [str(c) for c in df.columns]
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    out += [
        "| " + " | ".join(str(v) for v in r) + " |" for r in df.itertuples(index=False)
    ]
    return "\n".join(out)


def stats(e, a=None):
    e = np.asarray(e, float)
    d = {
        "n": len(e),
        "MAE": np.abs(e).mean(),
        "RMSE": np.sqrt((e**2).mean()),
        "bias(a-f)": e.mean(),
    }
    if a is not None:
        a = np.asarray(a, float)
        d["WAPE%"] = 100 * np.abs(e).sum() / a.sum()
        d["MAPE%"] = 100 * np.mean(np.abs(e) / a)
    return d


# ---------------- load + dedupe ----------------
wf = load("windfor")
fh = load("fuelhh")
print("## Raw counts\n")
print(f"- WINDFOR raw rows: {len(wf)}; FUELHH raw rows: {len(fh)}")
for c in ("publishTime", "startTime"):
    wf[c] = pd.to_datetime(wf[c], utc=True)
wf["generation"] = wf["generation"].astype(float)
d_wf_exact = wf.duplicated().sum()
d_wf_key = wf.duplicated(["publishTime", "startTime"]).sum()
wf = wf.drop_duplicates(["publishTime", "startTime"], keep="last")
fh["startTime"] = pd.to_datetime(fh["startTime"], utc=True)
fh["publishTime"] = pd.to_datetime(fh["publishTime"], utc=True)
fh["generation"] = fh["generation"].astype(float)
d_fh_key = fh.duplicated(["settlementDate", "settlementPeriod"]).sum()
fh = fh.sort_values("publishTime").drop_duplicates(
    ["settlementDate", "settlementPeriod"], keep="last"
)
print(
    f"- WINDFOR duplicates: exact={d_wf_exact}, on (publishTime,startTime)={d_wf_key}; after dedupe {len(wf)}"
)
print(
    f"- FUELHH duplicates on (settlementDate,settlementPeriod)={d_fh_key}; after dedupe {len(fh)}"
)
print(
    f"- FUELHH fuelType values: {sorted(fh.fuelType.unique())}; settlementPeriod range {fh.settlementPeriod.astype(int).min()}-{fh.settlementPeriod.astype(int).max()}"
)
lag = fh.publishTime - fh.startTime
print(
    f"- FUELHH publishTime - startTime: min {lag.min()}, median {lag.median()}, max {lag.max()}"
)
neg = (wf.generation < 0).sum()
print(
    f"- WINDFOR negative generation rows: {neg}; FUELHH negative: {(fh.generation < 0).sum()}"
)

act = fh.set_index("startTime")["generation"].sort_index()
full = pd.date_range("2026-01-01", "2026-02-01 23:30", freq="30min", tz="UTC")
missing = full.difference(act.index)
print(
    f"- FUELHH expected half-hours {len(full)}, present {act.index.isin(full).sum()}, missing {len(missing)}"
    + (f": {[str(m) for m in missing[:20]]}" if len(missing) else "")
)
# check startTime vs settlementDate/period consistency (Jan = GMT so SP1 starts 00:00 UTC)
exp_start = pd.to_datetime(fh.settlementDate).dt.tz_localize("UTC") + (
    fh.settlementPeriod.astype(int) - 1
) * pd.Timedelta(minutes=30)
print(
    f"- FUELHH rows where startTime != settlementDate + (SP-1)*30min: {(exp_start.values != fh.startTime.values).sum()}"
)

# ---------------- publish cadence ----------------
print("\n## WINDFOR publish cadence\n")
pubs = pd.Series(sorted(wf.publishTime.unique()))
pubs = pd.to_datetime(pubs, utc=True)
pc = pd.DataFrame({"date": pubs.dt.date, "hm": pubs.dt.strftime("%H:%M")})
per_day = pc.groupby("date")["hm"].agg(lambda s: ",".join(s))
cnt = pc.groupby("date").size()
pattern_counts = per_day.value_counts()
print(f"- distinct publishTimes: {len(pubs)} from {pubs.min()} to {pubs.max()}")
print(f"- runs per day: min {cnt.min()}, max {cnt.max()}; days: {len(cnt)}")
print("- distinct daily schedules (count of days):")
for p, n in pattern_counts.items():
    print(f"  - `{p}` : {n} days")
odd = per_day[per_day != pattern_counts.index[0]]
if len(odd):
    print("- days deviating from the modal schedule:")
    for d, p in odd.items():
        print(f"  - {d}: `{p}`")
gaps = pubs.diff().dropna()
print(
    f"- gap between consecutive publishes: min {gaps.min()}, max {gaps.max()} (max at {pubs[gaps.idxmax()]})"
)

wf["lead_h"] = (wf.startTime - wf.publishTime) / H
per_run = wf.groupby("publishTime").agg(
    points=("startTime", "size"),
    min_lead=("lead_h", "min"),
    max_lead=("lead_h", "max"),
    first=("startTime", "min"),
    last=("startTime", "max"),
)
print(f"- points per run: {per_run.points.value_counts().to_dict()}")
print(
    f"- min lead per run (h): {per_run.min_lead.value_counts().sort_index().to_dict()}"
)
print(
    f"- max lead per run (h): {per_run.max_lead.value_counts().sort_index().to_dict()}"
)
print(
    f"- runs whose last startTime hour (UTC): {per_run['last'].dt.strftime('%H:%M').value_counts().to_dict()}"
)
step = (
    wf.sort_values(["publishTime", "startTime"])
    .groupby("publishTime")
    .startTime.diff()
    .dropna()
    .value_counts()
)
print(f"- startTime step within runs: {step.to_dict()}")
print(
    f"- rows with negative lead (startTime before publishTime): {(wf.lead_h < 0).sum()} of {len(wf)}"
)

# ---------------- alignment test ----------------
# D-1 vintage: latest publish strictly before D-1 09:50 UTC
days = pd.date_range("2026-01-02", "2026-02-01", freq="D", tz="UTC")


def vintage_rows(cutoff_fn, wf=wf):
    out = []
    for D in days:
        cut = cutoff_fn(D)
        p = pubs[pubs < cut]
        if not len(p):
            continue
        pt = p.max()
        r = wf[
            (wf.publishTime == pt)
            & (wf.startTime >= D)
            & (wf.startTime < D + pd.Timedelta(days=1))
        ].copy()
        r["day"] = D
        out.append(r)
    return pd.concat(out) if out else pd.DataFrame()


da = vintage_rows(lambda D: D - pd.Timedelta(days=1) + GATE)
half = pd.Timedelta(minutes=30)
A = {
    "a: HH starting h": lambda t: act.reindex(t).values,
    "b: mean(h, h+30m)": lambda t: (
        (act.reindex(t).values + act.reindex(t + half).values) / 2
    ),
    "c: mean(h-30m, h)": lambda t: (
        (act.reindex(t - half).values + act.reindex(t).values) / 2
    ),
}
print("\n## Alignment test (D-1 09:50 vintage, delivery 2026-01-02..2026-02-01)\n")
print(
    f"- vintage publish times used: {da.groupby('day').publishTime.first().dt.strftime('%H:%M').value_counts().to_dict()}; hours/day: {da.groupby('day').size().value_counts().to_dict()}"
)
rows = []
for name, f in A.items():
    a = f(da.startTime)
    m = ~np.isnan(a)
    rows.append({"alignment": name, **stats(a[m] - da.generation.values[m])})
al = pd.DataFrame(rows)
print(md(al))
best = al.loc[al.MAE.idxmin(), "alignment"]
print(f"\nChosen (lowest MAE): **{best}**")
# also lag cross-check with all non-negative-lead vintages in 0-6h
short = wf[(wf.lead_h >= 0) & (wf.lead_h < 6)]
rows = []
for name, f in A.items():
    a = f(short.startTime)
    m = ~np.isnan(a)
    rows.append(
        {
            "alignment": name,
            "MAE (lead 0-6h, all runs)": np.abs(
                a[m] - short.generation.values[m]
            ).mean(),
        }
    )
print("\n" + md(pd.DataFrame(rows)))
align = A[best]


def attach(df):
    df = df.copy()
    df["actual"] = align(df.startTime)
    df = df.dropna(subset=["actual"])
    df["err"] = df.actual - df.generation
    return df


da = attach(da)

# ---------------- headline ----------------
print("\n## Headline error, D-1 09:50 vintage\n")
s = stats(da.err, da.actual)
print(md(pd.DataFrame([s]), "{:.1f}"))
print(
    f"\n- MAPE on hours with actual < 2 GW: {100 * np.mean(np.abs(da.err[da.actual < 2000]) / da.actual[da.actual < 2000]):.0f}% (n={int((da.actual < 2000).sum())}); min actual in sample {da.actual.min():.0f} MW"
)
print(
    f"- share of hours actual < forecast (over-forecast): {100 * (da.err < 0).mean():.1f}%"
)
print(
    f"- mean forecast {da.generation.mean():.0f} MW, mean actual {da.actual.mean():.0f} MW, ratio actual/forecast (sum) {da.actual.sum() / da.generation.sum():.3f}"
)
print(
    f"- correlation forecast vs actual: {np.corrcoef(da.generation, da.actual)[0, 1]:.3f}"
)
# OLS actual = a + b*forecast (coverage mismatch check)
b, a0 = np.polyfit(da.generation, da.actual, 1)
print(f"- OLS actual = {a0:.0f} + {b:.3f} * forecast")
daily = da.groupby("day").agg(
    bias=("err", "mean"), mae=("err", lambda e: e.abs().mean())
)
print(
    f"- daily bias: mean {daily.bias.mean():.0f}, days with positive bias {int((daily.bias > 0).sum())}/{len(daily)}, worst-MAE day {daily.mae.idxmax().date()} ({daily.mae.max():.0f} MW), best-MAE day {daily.mae.idxmin().date()} ({daily.mae.min():.0f} MW)"
)
hod = da.groupby(da.startTime.dt.hour).err.agg(["mean", lambda e: e.abs().mean()])
hod.columns = ["bias", "MAE"]
print(
    f"- bias by hour of day (UTC) range: {hod.bias.min():.0f}..{hod.bias.max():.0f}; MAE range {hod.MAE.min():.0f}..{hod.MAE.max():.0f}"
)

# ---------------- lead time ----------------
print("\n## Error by lead time (all vintages, startTime in delivery window)\n")
allv = attach(
    wf[
        (wf.lead_h >= 0)
        & (wf.startTime >= days[0])
        & (wf.startTime < days[-1] + pd.Timedelta(days=1))
    ]
)
bins = [0, 12, 24, 36, 48, 1000]
labels = ["0-12h", "12-24h", "24-36h", "36-48h", "48h+"]
allv["lead_b"] = pd.cut(allv.lead_h, bins, right=False, labels=labels)
lt = pd.DataFrame(
    [
        {"lead": k, **stats(g.err, g.actual)}
        for k, g in allv.groupby("lead_b", observed=True)
    ]
)
print(md(lt.drop(columns=["MAPE%"]), "{:.0f}"))
print(
    f"\n- max lead seen: {allv.lead_h.max():.1f} h; D-1 09:50 vintage lead range {((da.startTime - da.publishTime) / H).min():.1f}-{((da.startTime - da.publishTime) / H).max():.1f} h"
)
neg = attach(wf[(wf.lead_h < 0) & (wf.startTime >= days[0])])
if len(neg):
    print(
        f"- rows with negative lead (hindcast part of run): MAE {neg.err.abs().mean():.0f} MW (n={len(neg)}) -- {'looks like actuals echoed' if neg.err.abs().mean() < 200 else 'not equal to FUELHH'}"
    )

# ---------------- level bins ----------------
print("\n## Error spread by forecast level (D-1 09:50 vintage)\n")
lv_bins = [0, 5000, 10000, 15000, 20000, 1e9]
lv_lab = ["<5 GW", "5-10", "10-15", "15-20", ">20 GW"]


def level_table(df):
    df = df.assign(lvl=pd.cut(df.generation, lv_bins, right=False, labels=lv_lab))
    rows = []
    for k, g in df.groupby("lvl", observed=True):
        q = np.percentile(g.err, [10, 50, 90])
        rows.append(
            {
                "level": k,
                "n": len(g),
                "MAE": g.err.abs().mean(),
                "bias": g.err.mean(),
                "P10": q[0],
                "P50": q[1],
                "P90": q[2],
                "P90-P10": q[2] - q[0],
                "P10 ratio a/f x100": 100 * np.percentile(g.actual / g.generation, 10),
            }
        )
    return pd.DataFrame(rows)


print(md(level_table(da)))
print("\nSame, all vintages lead 12-48h (bigger sample):\n")
print(md(level_table(allv[(allv.lead_h >= 12) & (allv.lead_h < 48)])))

# ---------------- firm wind buffer ----------------
print("\n## Firm-wind buffer (D-1 09:50 vintage), leave-one-day-out\n")
da = da.assign(
    ratio=da.actual / da.generation,
    lvl=pd.cut(da.generation, lv_bins, right=False, labels=lv_lab),
)


def loo(conf, method):
    q = 100 * (1 - conf)
    hits, sizes, firm_sum = [], [], 0
    for D in days:
        tr, te = da[da.day != D], da[da.day == D]
        if not len(te):
            continue
        if method == "additive":
            firm = te.generation + np.percentile(tr.err, q)
        elif method == "ratio":
            firm = te.generation * np.percentile(tr.ratio, q)
        else:  # additive per level bin (fallback to pooled if bin thin)
            pooled = np.percentile(tr.err, q)
            qb = {
                k: (np.percentile(g.err, q) if len(g) >= 30 else pooled)
                for k, g in tr.groupby("lvl", observed=True)
            }
            firm = te.generation + te.lvl.map(qb).astype(float).fillna(pooled)
        firm = firm.clip(lower=0)
        hits.append(te.actual.values >= firm.values)
        sizes.append((te.generation - firm).values)
        firm_sum += firm.sum()
    h = np.concatenate(hits)
    days_ok = np.mean([x.all() for x in hits])
    return {
        "conf": f"{int(conf * 100)}%",
        "method": method,
        "LOO coverage %": 100 * h.mean(),
        "days fully covered %": 100 * days_ok,
        "mean haircut MW": np.concatenate(sizes).mean(),
        "firm as % of forecast": 100 * firm_sum / da.generation.sum(),
    }


in_sample = {
    c: {
        "P(err)": np.percentile(da.err, 100 * (1 - c)),
        "P(ratio)": np.percentile(da.ratio, 100 * (1 - c)),
    }
    for c in (0.9, 0.95)
}
for c, v in in_sample.items():
    print(
        f"- in-sample {int(c * 100)}% buffer: actual-forecast P{round(100 * (1 - c))} = {v['P(err)']:.0f} MW; actual/forecast P{round(100 * (1 - c))} = {v['P(ratio)']:.3f}"
    )
print()
print(
    md(
        pd.DataFrame(
            [
                loo(c, m)
                for c in (0.9, 0.95)
                for m in ("additive", "ratio", "additive-by-level")
            ]
        ),
        "{:.1f}",
    )
)

# LOO linear de-bias: fit actual = a + b*forecast on other days, then buffer on residuals of the corrected forecast
corr = []
for D in days:
    tr, te = da[da.day != D], da[da.day == D]
    if len(te):
        b_, a_ = np.polyfit(tr.generation, tr.actual, 1)
        corr.append(te.assign(fc=a_ + b_ * te.generation))
corr = pd.concat(corr)
corr["cerr"] = corr.actual - corr.fc
print(
    f"\n- LOO linear de-bias (actual ~ a + b*forecast): MAE {corr.cerr.abs().mean():.0f} (raw {da.err.abs().mean():.0f}), RMSE {np.sqrt((corr.cerr**2).mean()):.0f}, bias {corr.cerr.mean():.0f}"
)
for c in (0.9, 0.95):
    hits, firm_sum = [], 0
    for D in days:
        tr, te = corr[corr.day != D], corr[corr.day == D]
        firm = (te.fc + np.percentile(tr.cerr, 100 * (1 - c))).clip(lower=0)
        hits.append(te.actual.values >= firm.values)
        firm_sum += firm.sum()
    h = np.concatenate(hits)
    print(
        f"- de-biased + additive buffer {int(c * 100)}%: LOO coverage {100 * h.mean():.1f}%, firm as % of raw forecast {100 * firm_sum / da.generation.sum():.1f}%"
    )
hi = da[da.generation >= 18000]
print(
    f"- ceiling check: hours with D-1 forecast >= 18 GW: n={len(hi)}, actual mean {hi.actual.mean():.0f}, max {hi.actual.max():.0f}; Jan actual max {act.max():.0f}"
)

# ---------------- cutoff sweep ----------------
print(
    "\n## Cutoff sweep: latest vintage published at or before cutoff (delivery days 2026-01-02..02-01)\n"
)
slots = ["02:30", "04:30", "07:30", "09:30", "11:30", "15:30", "18:30", "22:30"]
rows = []
for dd, tag in ((2, "D-2"), (1, "D-1")):
    for s_ in slots:
        hh, mm = map(int, s_.split(":"))
        off = pd.Timedelta(days=-dd, hours=hh, minutes=mm)
        v = attach(vintage_rows(lambda D, off=off: D + off + pd.Timedelta(seconds=1)))
        after_gate = dd == 1 and pd.Timedelta(hours=hh, minutes=mm) > GATE
        rows.append(
            {
                "cutoff": f"{tag} {s_}" + (" (after 09:50 gate)" if after_gate else ""),
                "n": len(v),
                "MAE": v.err.abs().mean(),
                "RMSE": np.sqrt((v.err**2).mean()),
                "bias": v.err.mean(),
                "P10 err": np.percentile(v.err, 10),
            }
        )
cs = pd.DataFrame(rows)
print(md(cs))
b930 = cs.loc[cs.cutoff == "D-1 09:30", "MAE"].item()
print(
    f"\n- MAE D-1 09:30 vs D-2 09:30: {b930:.0f} vs {cs.loc[cs.cutoff == 'D-2 09:30', 'MAE'].item():.0f}; vs D-1 22:30 (not tradable day-ahead): {cs.loc[cs.cutoff.str.startswith('D-1 22:30'), 'MAE'].item():.0f}"
)

# ---------------- worst hours ----------------
print("\n## Worst hours (D-1 09:50 vintage)\n")
cols = ["startTime", "publishTime", "generation", "actual", "err"]
fmt = lambda d: d.assign(
    startTime=d.startTime.dt.strftime("%Y-%m-%d %H:%M"),
    publishTime=d.publishTime.dt.strftime("%m-%d %H:%M"),
).rename(columns={"generation": "forecast"})
print("Actual far BELOW forecast (forecast too high = buyer left short):\n")
print(md(fmt(da.nsmallest(5, "err")[cols])))
print(
    "\nActual far ABOVE forecast (forecast too low = under-forecast, buyer over-bought):\n"
)
print(md(fmt(da.nlargest(5, "err")[cols])))

# ---------------- scale ----------------
print("\n## Actual wind in January 2026 (FUELHH WIND, settlement dates 01-01..01-31)\n")
jan = act[(act.index >= "2026-01-01") & (act.index < "2026-02-01")]
print(
    f"- max {jan.max():.0f} MW at {jan.idxmax()}; min {jan.min():.0f} MW at {jan.idxmin()}; mean {jan.mean():.0f}; median {jan.median():.0f}; P5 {jan.quantile(0.05):.0f}; P95 {jan.quantile(0.95):.0f}"
)
print(
    f"- January energy: {jan.sum() * 0.5 / 1e6:.2f} TWh (transmission-metered wind only)"
)
print(
    f"- WINDFOR max forecast in all runs: {wf.generation.max():.0f} MW; min {wf.generation.min():.0f} MW"
)
dmean = jan.resample("D").mean()
print(
    f"- daily mean range {dmean.min():.0f} ({dmean.idxmin().date()}) .. {dmean.max():.0f} ({dmean.idxmax().date()}) MW"
)
ramp = jan.diff().abs()
print(
    f"- largest half-hour ramp {ramp.max():.0f} MW at {ramp.idxmax()}; largest 24h swing in daily mean {dmean.diff().abs().max():.0f} MW"
)

# self-check: alignment helpers return same length; stats sanity
assert len(A["b: mean(h, h+30m)"](da.startTime.head(3))) == 3
assert abs(stats([1, -1])["MAE"] - 1) < 1e-9 and stats([1, -1])["bias(a-f)"] == 0
