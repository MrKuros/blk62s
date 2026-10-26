# Methodology

This document explains how Firm Wind turns two Elexon datasets into an answer for a day-ahead buyer, and why each choice was made. The rules were fixed before the January results were examined, and the same rules run for every day and every setting.

The values the app computes (MAE, bias, coverage, gains, run differences and so on) are deliberately **not** copied here, because they would drift whenever the analysis or data changes. Where this document says *see app*, the number appears in the UI, the API (`/api/docs`) and `scripts/story_numbers.py`, and is frozen by the golden test. Facts quoted from external sources are cited.

Sign convention in the analysis: **error = actual − forecast**, so a negative error means the forecast was too high. The UI shows the opposite sign as **forecast bias = forecast − actual**, where positive means the forecast was too high.

---

## 1. No lookahead: what is knowable when

A purchase for delivery day **D** is fixed at an auction gate on **D-1**. Every number the app shows for D uses only data published before that gate.

```
 D-2 (UK local)              D-1 (UK local)                               D
 │                           │                                            │
 ┼──┬─────┬─────┬── … ──┬────┼──┬─────┬─────┬─────╂─┬─────╂──┬──── … ─────┼═══ delivery 00:00–24:00 ═══►
    02:30 04:30 07:30   22:30   02:30 04:30 07:30 │ 09:30 │  11:30
                                                  │       │
                                             EPEX 09:20    N2EX 09:50
                                             gate          gate

 EPEX buyer: runs with publishTime < 09:20 D-1 → decision run 07:30 D-1 (January)
 N2EX buyer: runs with publishTime < 09:50 D-1 → decision run 09:30 D-1 (January)
 Runs at or after the gate: drawn dashed as "too late", never used for the day-ahead decision or its statistics. The Timing tab scores them only as context, to show what waiting past the gate would have bought.
 Actuals known at the gate: FUELHH half-hours published before it (up to about 09:00 D-1).
 D-1 is incomplete at the gate, so training for day D uses delivery days ≤ D-2 only.
```

How this is enforced:
- **Strict inequality.** A run counts only if `publishTime < cutoff`. A run published exactly at the gate is excluded (unit test).
- **Gate in UK local time.** The gate is a time on D-1 in `Europe/London`, converted to UTC per day. This makes DST transitions correct: delivery on 2026-03-29 has its gate at 2026-03-28 09:20Z, and on 2026-03-30 at 2026-03-29 08:20Z (unit test). Delivery days are London-local days of 23, 24 or 25 hours.
- **Latency margin.** An optional 0, 10, 20 or 60 minute margin moves the cutoff earlier, for buyers who cannot rely on downloading a run the moment it is published. 60 minutes replays January as if runs only became usable at the times Elexon's page documents (below): N2EX then uses the 07:30 run, and EPEX keeps it, so the EPEX headline does not depend on this assumption.
- **Property test.** For every delivery day, both auctions, two custom cutoffs and every margin, the test asserts three things. Every WINDFOR `publishTime` used is before the cutoff. Every training day is ≤ D-2. Persistence and ceiling values use only FUELHH rows whose `publishTime` is before the cutoff. It then **doubles every value published at or after the cutoff** and asserts that the replay output for D is unchanged.

---

## 2. Data sources and their semantics

Both series come from the Elexon BMRS Insights API (no key needed): the `WINDFOR` and `FUELHH` (`fuelType=WIND`) stream endpoints. The bundled snapshot covers WINDFOR runs published from 30 Nov 2025 to 1 Feb 2026, and FUELHH settlement days from 1 Dec 2025 to 1 Feb 2026. It is the data source for the January pilot. December is included only for the optional calibration toggle (§7).

### WINDFOR: NESO's national wind forecast
- **Fields:** `publishTime`, `startTime` (hourly, always on :00) and `generation` (MW).
- **Cadence (observed).** In January the API showed eight runs every day, published at 02:30, 04:30, 07:30, 09:30, 11:30, 15:30, 18:30 and 22:30 UTC, with 73 hourly points each. Each run covers 21:00 UK local on the day before publication to 21:00 on publish day + 2. A consequence is that runs published on D-2 stop at 21:00 on D and cover only 22 of D's 24 hours.
- **Observed vs documented times.** The BMRS wind page lists publication "up to 8 times a day at 03:30, 05:30, 08:30, 10:30, 12:30, 16:30, 19:30 and 23:30", which is exactly one hour later than the `publishTime` values seen in GMT. The Elexon glossary still describes four runs a day with 49 values. The app treats the API's `publishTime` as authoritative. Whether `publishTime` equals the moment a run can actually be downloaded is **unverified**, which is why the latency margin exists.
- **Off-schedule run.** On 15 Jan 2026 the 11:30 run was published at 12:25. The value-of-waiting slots tolerate this (§8).
- **Hindcast rows.** Every run includes 5 to 25 hours *before* its own `publishTime`. These are not actuals echoed back: they disagree with FUELHH by roughly as much as genuine forecasts do. They could never inform a decision, so `clean_windfor` drops every row with `startTime < publishTime`.

### FUELHH (WIND): metered outturn
- **Meaning:** half-hourly average MW from NESO operational (SCADA) metering of wind BM units. `startTime` is the start of the settlement period. `publishTime` is usually 30 minutes after the start, with occasional rows arriving up to a couple of hours late. The no-lookahead rules use the real `publishTime`, not an assumed lag.
- **Settlement day** is the UK local day, with 46 or 50 periods on clock-change days.

### Coverage and the over-forecast
- **Same fleet by definition.** Both series cover wind farms visible to NESO with operational metering, which is mostly transmission-connected. Embedded or distribution-connected wind is in neither. NESO estimates the operationally metered fleet at about 82% of GB wind as of 2025 ([BMRS, generation by fuel type](https://bmrs.elexon.co.uk/generation-by-fuel-type)). The app reports MW only and no capacity factors, because no cited capacity denominator matches the FUELHH fleet exactly.
- **Different measure.** WINDFOR runs consistently above FUELHH, and the gap grows with forecast level. Delivered wind also behaves as if it had a ceiling well below the highest forecasts (*see app*: the Forecast accuracy tab marks the highest actual generation). The **likely cause** is curtailment: FUELHH meters output *after* balancing-mechanism turn-down, which is concentrated in high-wind hours in Scotland ([SmartestEnergy](https://www.smartestenergy.com/en_GB/insights/the-informer/cost-of-curtailment-hits-1bn/)), while WINDFOR may forecast available, unconstrained output. **This is unverified.** No Elexon or NESO document states WINDFOR's constraint basis, and the app does not test it against bid-offer acceptance volumes (see §12).
- **Why the buyer should still target FUELHH.** Metered output is the wind that actually arrives. Whatever the cause, a firm-wind number calibrated against FUELHH is the right number for procurement.

### Data integrity
- `data.normalise` casts the string fields to numbers and de-duplicates on `(publishTime, startTime)` for WINDFOR and on `startTime` for FUELHH (keeping the latest-published value).
- The **data hash** is computed on the normalised values, not the file bytes. It appears in every payload, every CSV receipt and every frontend query key.
- On start-up the API refetches the same ranges in the background and compares hashes. The UI badge then reads **verified**, **changed** (the snapshot is still served, so every view stays consistent, and a warning is logged) or **unreachable**.

---

## 3. Aligning hourly forecasts with half-hourly actuals

The traded product is an hour, so the forecast for hour *h* is compared with **the mean of the FUELHH half-hours starting at *h* and *h + 30 min*** (`hour_mean`). That is the energy of the hourly block. If either half-hour is missing, the hour is dropped.

WINDFOR does not document whether its hourly value is an instantaneous figure or an hourly average. The rule above was fixed in advance, and two alternatives are reported in a sensitivity table (methodology drawer):

| Variant | Actual used for forecast hour *h* |
|---|---|
| `hour_mean` (default) | mean(HH[*h*], HH[*h*+30m]) |
| `hh_start` | HH[*h*] |
| `centred` | mean(HH[*h*−30m], HH[*h*]) |

The differences between them are small next to the bias (*see app*), so the conclusions do not depend on the choice. The default was not switched to whichever variant scored best on January, because that would be tuning on the test set.

---

## 4. Choosing the decision run

For delivery day D and cutoff *c* (gate minus margin, in UTC):

1. Take every cleaned WINDFOR row with `publishTime < c`.
2. Select the **latest** `publishTime` among them.
3. Restrict that run to the delivery hours of D.

Lead time (hours ahead) is `startTime − publishTime`. The Decision tab's gate timeline shows every forecast run from D-2 to delivery; runs at or after the cutoff are marked "too late". The Decision tab states which run the EPEX and N2EX gates each use; the Timing tab shows the difference in their mean absolute error.

---

## 5. Metrics

Computed over the hourly pairs of the decision run (n = hours, reported every time):

| Metric | Definition | UI label |
|---|---|---|
| MAE | mean \|actual − forecast\| | Mean absolute error |
| Bias | mean(actual − forecast) | Forecast bias (shown as forecast − actual, + = too high) |
| WAPE | Σ\|actual − forecast\| / Σ actual | Error as % of actual generation |
| RMSE | √mean((actual − forecast)²) | drawer only |
| Over-forecast share | share of hours with actual < forecast | Forecast accuracy tab ("forecast too high in … of hours") |
| Correlation | Pearson r between forecast and actual | Forecast accuracy tab |

MAPE is not used. It explodes when wind is low, and January happens not to have hours low enough to show that, so it would look misleadingly stable.

---

## 6. Uncertainty: moving-block bootstrap

Errors are strongly autocorrelated within a day and across neighbouring days, because weather regimes last for days. Resampling individual hours would produce CIs that are far too narrow.

- Statistics are built from **per-day sums**: n, Σ|e|, Σe, Σe² and Σactual. A resample is therefore a re-weighting of days, which keeps the computation vectorised and exact.
- **Blocks:** contiguous 3-day blocks. Each block's start is drawn uniformly from [0, n − 3], and blocks are concatenated and truncated to n = 31 days.
- **2,000 resamples, fixed seed** (20260101), so results are reproducible (unit test).
- The interval is the 5th to 95th percentile, labelled **"approx. 90% CI, n = 31 days"**.
- **Comparisons are paired.** Raw vs corrected, D-2 vs gate and EPEX vs N2EX each compute the difference on the *same* resampled days. A paired difference of identical inputs is exactly zero (unit test).

---

## 7. Correction and firm wind (walk-forward)

### Walk-forward calibration
For each delivery day D, the model is fitted only on delivery days in **[train_start, D-2]**, with each training day's forecast chosen by the same cutoff rule as D. No information from D, or from D-1 (incomplete at the gate), enters.

1. **Correction:** OLS of `actual = a + b · forecast` on the training hours, giving `corrected = a + b · forecast`.
2. **Ratio distribution:** `ratio = actual / corrected` on the training hours. Hours with `corrected < 500 MW` are dropped so the ratio stays stable. The **1st to 99th percentiles** form the quantile grid `q`.
3. **Firm wind** at accepted shortfall frequency *r* (1 to 50%): `firm = max(0, corrected × q[r])`. By construction, delivered wind should exceed it in about (100 − r)% of hours.
4. **Band:** `corrected × [q[r], q[100 − r]]`.

The API returns `q` for each day, so the browser computes firm wind, coverage and energy without refetching when the buyer moves the reliability control. A Python-generated fixture checks the TypeScript implementation against the Python one within 1e-9.

### Why the ratio method
It was chosen in advance: it is scale-free (the haircut grows with the forecast, as the error does) and has one parameter. Two alternatives appear only in the methodology drawer's comparison table, computed walk-forward with and without 28 Jan:
- **additive:** corrected + quantile of the error;
- **per-level:** additive quantiles per forecast-level bin (0–5, 5–10, 10–15, 15–20, > 20 GW), falling back to the pooled quantile when a bin has fewer than 30 training samples. Fallbacks are counted and shown.

### Reliability in buyer terms
- **Hours covered:** the share of hours with actual ≥ firm.
- **Whole days covered:** the share of days on which *every* hour was covered. Errors cluster by day, so this is much lower than hourly coverage, and both are always shown.
- **Shortfall:** the energy by which delivered wind fell below the firm value, nationally.
- **Shortfall energy vs P90 plan:** shown on the Firm wind (P90) tab, the national GWh by which actual generation fell below the P90 wind level the buyer planned on. A buyer's own exposure scales with their share. The per-hour gap the buyer holds back is forecast minus P90.
- **Reliability chart:** target (50 to 99%) against achieved coverage, for hours and for whole days. If the method is calibrated, the lines sit on the diagonal.
- **Choosing *r* from costs:** in Advanced mode the buyer enters the cost of being short and the cost of surplus, and *r* = 100 · surplus / (short + surplus), clamped to 1 to 50. This is the newsvendor critical ratio: the more expensive a shortfall, the less often you accept one.

### Warm-up
A day whose training window has **fewer than 5 days** is marked *calibrating*. It shows the raw forecast with a badge and is **excluded from coverage statistics**. The number of days and hours behind every coverage figure is reported. With the January window this covers roughly the first week of deliveries (*see app*).

### "Include December 2025 history"
The default calibration window starts on 2 Jan 2026, so it uses only January-relevant data. The toggle moves `train_start` to **1 Dec 2025** and reruns the same walk-forward. That is history a trader would really have held at the time, still Elexon data only, and it removes the warm-up. The methodology drawer shows both results side by side, scored on the same days (those after the January-only warm-up), so the columns differ only in training history. On those days December history barely changes the corrected forecast's mean absolute error. December has its own seasonality and curtailment pattern, so neither window is assumed to be "right".

---

## 8. Value of waiting

The question (Timing tab): how much does the mean absolute error shrink if you decide later?

- **Slots:** the eight nominal WINDFOR times on D-2 and on D-1, 16 slots from D-2 02:30 to D-1 22:30. A slot's cutoff is its nominal local time **+ 59 minutes**, so a late run, such as the 12:25 run on 15 Jan, is assigned to its own slot (11:30) instead of being lost.
- **Common hours.** Each slot is scored only on hours that **every** slot covers. D-2 runs stop at 21:00 on D, so the comparison is like for like and not biased by D-1 runs covering more hours.
- **Gates:** EPEX and N2EX are marked. Slots after a gate are shaded as *not available day-ahead*. They show the value forgone at the gate, which is context for an intraday strategy, not a choice for the day-ahead buyer.
- **Gains:** paired bootstrap CIs for D-2 → gate, and for the EPEX vs N2EX decision run (*see app*).

---

## 9. Baselines

- **Persistence:** the last FUELHH value whose `publishTime` is before the cutoff, held flat across D. It shows how much skill the forecast adds over "tomorrow looks like now".
- **D-2 run:** the same-time run on D-2, scored on the 22 hours it covers, against the decision run on the same 22 hours.
- **Delivered ceiling:** the highest hourly actual known before the cutoff. It feeds the above-ceiling signal.

---

## 10. Signals and the Why panel

The signals are deterministic templates filled from computed numbers. There is no free text and no LLM. Each rule returns an id and parameters, and the frontend renders the sentence:

| Rule | Fires when |
|---|---|
| Stale feed | the decision run repeats, value for value, at least the two runs before it (the NESO feed stopped updating) |
| Above ceiling | the raw forecast exceeds the highest delivered wind known before the cutoff |
| Revision | the decision run differs from the previous run by ≥ 1 GW on average |
| Correction | the correction lowers the forecast by ≥ 1 GW on average |
| Calibrating | the day is still in warm-up |

The headline signal is the first rule that fires, in this order (a stale feed outranks everything, because every other number is then out of date). A stale feed is shown in the answer hero as "Forecast feed frozen"; the other signals go to the Decision tab's Why panel.

---

## 11. Data caveats

### 28 January 2026: a NESO IT incident, not weather
NESO's January 2026 reported-metrics document attributes the month's peak absolute day-ahead wind-forecast error, **4.7 GW on 28 Jan, settlement period 44**, to an IT ingestion failure on 27–28 Jan ([NESO reported metrics, Jan 2026](https://www.neso.energy/document/377601/download)). It is also one of the worst days in the app's own data (*see app*). The app keeps it in, because a buyer would have faced it. P90 wind and coverage results are shown **with and without** 28 Jan. The bad run could not be spotted from its level or as a revision, because it matched the earlier runs exactly: the feed had frozen, and the 28 Jan decision run repeated every run since 26 Jan 18:30 UTC. That freeze was visible before the gate, so on 28 Jan the UI flags "Forecast feed frozen" (§10); NESO only confirmed the IT ingestion failure later.

### The NESO benchmark is not comparable
NESO's own day-ahead wind metric (RIIO-2 Metric 1C) was **4.99% of capacity for January 2026** (same source). It differs from this app's error in several ways:
- **Outturn basis:** it scores against settlement-metered outturn and **excludes sites with bid-offer acceptances (curtailment) and sites redeclared to zero**. FUELHH includes curtailment.
- **Resolution and units:** it uses half-hourly MAE as a % of capacity. The app uses hourly MW.
- **Forecast:** it scores the 09:00–10:00 D-1 issue. The app uses the latest run before the buyer's gate.

The app's error is therefore curtailment-inclusive and reads worse by construction. The app neither claims to beat NESO nor to miss NESO's figure.

---

## 12. Limitations and next steps

**Limitations**
- **One month.** 31 delivery days give wide CIs (shown). Seasonality, curtailment patterns and the forecast itself change through the year, so the January calibration should not be carried into summer. The Tomorrow (live) tab recalibrates on the trailing 30 days for this reason.
- **Over-forecast cause unverified.** Without balancing-mechanism data the app cannot separate forecast skill from turn-down.
- **Availability of runs.** `publishTime` is taken as the time a run became available. The N2EX case (the 09:30 run, 20 minutes before close) depends on this, and the latency margin lets the buyer stress it: at 60 minutes N2EX falls back to the 07:30 run.
- **FUELHH revisions.** Whether Elexon revises a value after first publication is unverified. The live hash check would flag it as *changed*.
- **National scale only.** All MW and GWh are GB-national, for the operationally metered fleet. A buyer's exposure is their share of it.
- **Simple models.** The correction is linear and the quantiles assume recent days resemble tomorrow. Both are deliberate (transparent, validated out of sample), not optimal.

**Next steps**
1. **Curtailment via BOALF.** Sum wind BM-unit bid-offer acceptances for the worst hours, for example the night of 11–12 Jan, to test the curtailment explanation. Then model delivered wind as forecast minus expected turn-down.
2. **Intraday re-optimisation.** The Timing tab shows that later runs are more accurate. A buyer could trade the residual in intraday markets using post-gate runs.
3. **Other fuels and demand.** Solar and demand forecasts would turn "P90 wind" into "residual volume to buy". They are outside this brief, which is limited to Elexon wind data.
