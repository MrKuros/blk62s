"""Print the pitch numbers (README, video, PLAN §2) as markdown, computed from the bundled snapshot.

Run: uv run --project backend python scripts/story_numbers.py
Everything is walk-forward / out of sample unless a row says "in-sample". CIs are approximate 90%
moving-block bootstrap intervals (3-day blocks, 2,000 resamples, fixed seed) over delivery days.
"""

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from app import analysis as A  # noqa: E402
from app.data import load_snapshot  # noqa: E402
from app.signals import STALE_RUNS  # noqa: E402

HOOK_DAY = date(2026, 1, 12)


def mw(v: float) -> str:
    return f"{v:,.0f}".replace("-", "−")


def pct(v: float) -> str:
    return f"{100 * v:.1f}%".replace("-", "−")


def ci(t: tuple[float, float, float], f=mw) -> str:
    return f"{f(t[0])} [{f(t[1])}, {f(t[2])}]"


def table(header: list[str], rows: list[list[str]]) -> str:
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    return "\n".join(out + ["| " + " | ".join(r) + " |" for r in rows])


def boot(sums: pd.DataFrame, stat: str, other: pd.DataFrame | None = None) -> tuple[float, float, float]:
    return A.boot_ci(sums, stat, A.block_bootstrap_idx(len(sums)), other)


def column(out: pd.DataFrame, fits: dict) -> dict[str, str]:
    m = A.metrics(out.err, out.actual)
    sums = A.day_sums(out)
    b, a = np.polyfit(out.forecast, out.actual, 1)
    col = {
        "Hours / days": f"{m['n']} / {out.day.nunique()}",
        "Typical miss, MAE (MW)": ci(boot(sums, "mae")),
        "Bias, actual − forecast (MW)": ci(boot(sums, "bias")),
        "WAPE": ci(boot(sums, "wape"), pct),
        "RMSE (MW)": mw(m["rmse"]),
        "Hours over-forecast": pct((out.err < 0).mean()),
        "Days with negative bias": f"{(out.groupby('day').err.mean() < 0).sum()} / {out.day.nunique()}",
        "Correlation forecast vs actual": f"{np.corrcoef(out.forecast, out.actual)[0, 1]:.3f}",
        "OLS actual = a + b·forecast (in-sample)": f"{a:,.0f} + {b:.3f}·f",
        "Actual / forecast (sums)": f"{out.actual.sum() / out.forecast.sum():.3f}",
    }
    for row in A.level_table(out):
        col[f"Bias at {row['label']} (n)"] = "–" if row["bias"] is None else f"{mw(row['bias'])} ({row['n']})"

    fitted = out[~out.calibrating]
    raw_s, cor_s = A.day_sums(fitted, "err"), A.day_sums(fitted, "cerr")
    col["Fitted days (warm-up excluded)"] = str(len(raw_s))
    col["Raw MAE on fitted days"] = ci(boot(raw_s, "mae"))
    col["Corrected MAE (walk-forward)"] = ci(boot(cor_s, "mae"))
    col["Gain: corrected − raw (paired)"] = ci(boot(cor_s, "mae", raw_s))
    col["Corrected bias"] = mw(fitted.cerr.mean())

    for r in (10, 5):
        for label, ex in (("all", ()), ("ex 28 Jan", {A.EXCLUDED_DAY})):
            c = A.coverage(out, fits, r, ex)
            col[f"Firm r={r}% ({label}): hours / whole days covered"] = (
                f"{pct(c['hour_cov'])} / {pct(c['day_cov'])} (n={c['n_hours']} h, {c['n_days']} d)"
            )
        c = A.coverage(out, fits, r)
        col[f"Firm r={r}%: firm as % of raw forecast"] = pct(c["firm_pct"])
        col[f"Firm r={r}%: shortfall vs firm (GWh, national)"] = f"{c['shortfall_gwh']:,.1f}"
    return col


def main() -> None:
    snap = load_snapshot()
    wf, fh = A.clean_windfor(snap.windfor), snap.fuelhh
    actual = A.hourly_actual(fh)
    print(f"# Story numbers (snapshot {snap.hash}, margin 0, delivery {A.DAYS[0]} .. {A.DAYS[-1]})\n")

    frames, cols = {}, {}
    for cutoff in ("epex", "n2ex"):
        frame = A.decision_frame(wf, fh, A.HISTORY_DAYS, A.parse_cutoff(cutoff), 0)
        for calib in ("jan", "dec"):
            out, fits = A.walk_forward(frame, A.DAYS, A.TRAIN_START[calib])
            frames[cutoff, calib] = out, fits
            cols[f"{cutoff} / {calib}"] = column(out, fits)
    names = list(cols)
    print("## Headline, correction and firm wind (raw rows do not depend on calibration)\n")
    print(table(["Metric", *names], [[k, *(cols[n][k] for n in names)] for k in cols[names[0]]]))

    # ---- ceiling
    epex, n2ex = frames["epex", "jan"][0], frames["n2ex", "jan"][0]
    jan = fh[fh.startTime.dt.tz_convert(A.LONDON).dt.date.between(date(2026, 1, 1), date(2026, 1, 31))]
    window = wf[wf.startTime.isin(epex.startTime)]
    print("\n## Delivered ceiling vs forecast\n")
    print(
        table(
            ["Measure", "MW"],
            [
                ["Max hourly actual, delivery days", mw(epex.actual.max())],
                ["Max half-hour actual, 1–31 Jan", mw(jan.generation.max())],
                ["Max EPEX decision-run forecast", mw(epex.forecast.max())],
                ["Max forecast in any run for the delivery hours", mw(window.generation.max())],
                [
                    "Decision-run hours forecast above the max actual",
                    str(int((epex.forecast > epex.actual.max()).sum())),
                ],
            ],
        )
    )

    # ---- auction choice
    both = epex.merge(n2ex, on=["day", "startTime"], suffixes=("_e", "_n"))
    diff = both.forecast_n - both.forecast_e
    e_s, n_s = A.day_sums(epex), A.day_sums(n2ex)
    print("\n## EPEX (09:20, 07:30 run) vs N2EX (09:50, 09:30 run)\n")
    print(
        table(
            ["Measure", "Value"],
            [
                ["Hours compared", str(len(both))],
                ["Mean run difference, N2EX − EPEX (MW)", mw(diff.mean())],
                ["Mean absolute run difference (MW)", mw(diff.abs().mean())],
                [
                    "Days whose mean difference exceeds ±500 MW",
                    str(int((diff.groupby(both.day).mean().abs() >= 500).sum())),
                ],
                [
                    "MAE EPEX / N2EX (MW)",
                    f"{mw(A.metrics(epex.err, epex.actual)['mae'])} / "
                    f"{mw(A.metrics(n2ex.err, n2ex.actual)['mae'])}",
                ],
                ["MAE difference, N2EX − EPEX (paired)", ci(boot(n_s, "mae", e_s))],
            ],
        )
    )

    # ---- value of waiting
    # The gate runs come from the decision frames, not the d1_0730 / d1_0930 slots: a slot's 59-minute
    # grace reaches past the gate, so a late 09:30 run would sit in the "09:30" slot yet miss N2EX.
    slots = A.slot_frames(wf, actual, A.DAYS)
    gates = {"epex": epex, "n2ex": n2ex}
    common = A.common_hours({**slots, **gates})
    on_common = {k: f[f.startTime.isin(common)] for k, f in {**slots, **gates}.items()}
    sums = {k: A.day_sums(f) for k, f in on_common.items()}
    rows = []
    for k, f in on_common.items():
        m = A.metrics(f.err, f.actual)
        name = f"{k.upper()} gate run" if k in gates else k
        rows.append([name, ci(boot(sums[k], "mae")), mw(m["bias"]), mw(m["rmse"]), str(m["n"])])
    print(f"\n## Value of waiting (common hours: {len(common)})\n")
    print(table(["Slot", "MAE [90% CI]", "Bias", "RMSE", "n"], rows))
    d2 = [k for k in sums if k.startswith("d2")]
    best_d2 = min(d2, key=lambda k: A.metrics(on_common[k].err, on_common[k].actual)["mae"])
    gains = []
    for gate, same in (("epex", "d2_0730"), ("n2ex", "d2_0930")):
        for start in (same, best_d2):
            g = boot(sums[gate], "mae", sums[start])
            base = boot(sums[start], "mae")[0]
            gains.append([f"{start} → {gate.upper()} gate run", ci(g), pct(g[0] / base)])
    g = boot(sums["d1_1130"], "mae", sums["n2ex"])
    gains.append(
        ["N2EX gate run → d1_1130 (after both gates)", ci(g), pct(g[0] / boot(sums["n2ex"], "mae")[0])]
    )
    print("\n" + table(["Wait", "MAE change [90% CI] (paired)", "Relative"], gains))

    # ---- 12 Jan hook
    out, fits = frames["epex", "jan"]
    hook = out[out.day == HOOK_DAY]
    peak = hook.loc[hook.forecast.idxmax()]
    print(f"\n## Hook: {HOOK_DAY} (EPEX, {hook.publishTime.iloc[0]:%d %b %H:%M} UTC run)\n")
    print(
        table(
            ["Measure", "MW"],
            [
                ["Peak forecast", f"{mw(peak.forecast)} at {peak.startTime:%H:%M} UTC"],
                ["Actual at that hour", mw(peak.actual)],
                ["Day mean forecast / actual", f"{mw(hook.forecast.mean())} / {mw(hook.actual.mean())}"],
                ["Day max actual", mw(hook.actual.max())],
                ["Day MAE raw / corrected", f"{mw(hook.err.abs().mean())} / {mw(hook.cerr.abs().mean())}"],
                [
                    "Firm at r=10% (mean of hours)",
                    mw(A.firm(hook.corrected.to_numpy(), fits[HOOK_DAY].q, 10).mean()),
                ],
            ],
        )
    )

    # ---- 28 Jan
    print(f"\n## {A.EXCLUDED_DAY}: was the bad run detectable before the gate?\n")
    pubs = pd.DatetimeIndex(wf.publishTime.unique()).sort_values()

    def revision(run: pd.DataFrame, base: pd.DataFrame) -> float:
        return (run.set_index("startTime").generation - base.set_index("startTime").generation).mean()

    def day_run(pub: pd.Timestamp) -> pd.DataFrame:
        return A.run_for_day(wf, A.EXCLUDED_DAY, pub + pd.Timedelta(seconds=1))

    rows, fresh, fresh_rev = [], {}, {}
    for cutoff in ("epex", "n2ex"):
        out, fits = frames[cutoff, "jan"]
        d = out[out.day == A.EXCLUDED_DAY]
        pub = d.publishTime.iloc[0]
        used = day_run(pub)
        n, since = A.unchanged_runs(wf, pub)
        nxt_pub = pubs[pubs > pub][0]
        fresh[cutoff] = next(p for p in pubs[pubs > pub] if A.unchanged_runs(wf, p)[0] == 1)
        fresh_rev[cutoff] = revision(day_run(fresh[cutoff]), used)
        cut = A.cutoff_utc(A.EXCLUDED_DAY, A.parse_cutoff(cutoff))
        ceiling = A.ceiling_known(fh, A.TRAIN_START["jan"], cut)
        month = out[out.day < A.EXCLUDED_DAY]
        rows.append(
            [
                cutoff,
                f"{pub:%d %b %H:%M}",
                mw(revision(used, A.run_for_day(wf, A.EXCLUDED_DAY, pub))),
                f"{n} runs since {since:%d %b %H:%M}",
                f"{mw(d.forecast.mean())} (Jan mean {mw(month.forecast.mean())}, ceiling {mw(ceiling)})",
                mw(d.actual.mean()),
                mw(d.err.abs().mean()),
                f"{mw(revision(day_run(nxt_pub), used))} ({nxt_pub:%d %b %H:%M})",
                f"{mw(fresh_rev[cutoff])} ({fresh[cutoff]:%d %b %H:%M})",
            ]
        )
    print(
        table(
            [
                "Gate",
                "Run used",
                "Revision vs previous run",
                "Unchanged",
                "Mean forecast",
                "Mean actual",
                "MAE",
                "Next run's revision",
                "First updated run's revision",
            ],
            rows,
        )
    )
    others = [
        day
        for day in A.DAYS
        if A.unchanged_runs(wf, frames["epex", "jan"][0].query("day == @day").publishTime.iloc[0])[0]
        >= STALE_RUNS
    ]
    first = fresh["epex"]
    after_both = first >= A.cutoff_utc(A.EXCLUDED_DAY, A.AUCTIONS["n2ex"])
    print(
        f"\nVerdict: the error itself was not visible before the gate. The run used had a normal level (well"
        f" under the delivered ceiling) and a zero revision, because it was an exact copy of every run"
        f" since 26 Jan 18:30: the NESO forecast had stopped updating. That symptom was visible before"
        f" both gates, and a 'forecast not updating' rule ({STALE_RUNS}+ identical runs, signal id"
        f" `run_jump`) fires on {', '.join(map(str, others))} only among January EPEX decision runs."
        f" The first updated run ({first:%d %b %H:%M}{', after both gates' if after_both else ''}) revised"
        f" the day by {mw(fresh_rev['epex'])} MW; every run between the EPEX decision run and it was"
        f" still frozen."
    )


if __name__ == "__main__":
    main()
