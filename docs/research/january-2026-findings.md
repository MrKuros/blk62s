# January 2026 wind data: exploratory findings

> **Note on method.** This pre-build pass used the **N2EX 09:50 gate (so the 09:30 run)** and **leave-one-day-out** validation. The app replaced both: its default is the **EPEX 09:20 gate (07:30 run)**, and corrections and buffers are validated **walk-forward** (each day is fitted only on delivery days up to D-2, because leave-one-day-out trains on future days). Numbers below therefore differ slightly from the app; the final ones are in [final-numbers.md](final-numbers.md). The qualitative findings stand.

Analysis run on 2026-10-26 against live Elexon BMRS Insights API data.

- Scripts: [`exploratory/fetch.py`](exploratory/fetch.py) (fetches and caches into `exploratory/raw/`) and [`exploratory/jan_analysis.py`](exploratory/jan_analysis.py) (prints the full markdown output these notes summarise). Run fetch first, then analysis; see the header of each script.

Endpoints used:

- https://data.elexon.co.uk/bmrs/api/v1/datasets/WINDFOR/stream?publishDateTimeFrom=...&publishDateTimeTo=... (7-day chunks, publishTime from 2025-12-31T00:00Z to 2026-02-01T00:00Z)
- https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELHH/stream?settlementDateFrom=...&settlementDateTo=...&fuelType=WIND (7-day chunks, settlement dates 2026-01-01 to 2026-02-01)

Conventions:

- error = actual − forecast, so a negative value means the forecast was too high.
- The "D-1 vintage" is the latest WINDFOR run published strictly before 09:50 UK time on D-1. January is on GMT, so UK time equals UTC.
- Delivery days run from 2026-01-02 to 2026-02-01 (31 days, 744 hours).

## 1. Data quality

| Item                                     | Result                                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WINDFOR rows                             | 18,688 = 256 runs × 73 hourly points. No duplicates, exact or on (publishTime, startTime).                                                                                           |
| FUELHH WIND rows                         | 1,536 = 32 days × 48 periods. No duplicates, no missing half-hours, no negative values.                                                                                              |
| FUELHH startTime vs (settlementDate, SP) | Consistent for every row: SP1 starts at 00:00 UTC in January.                                                                                                                        |
| FUELHH publish lag                       | 30 min after period start (median), at most 2h25m.                                                                                                                                   |
| Fields                                   | WINDFOR: `publishTime, startTime, generation` (MW, as a string). FUELHH: `startTime, settlementDate, settlementPeriod, generation` (as a string). The app must cast both to numbers. |

### WINDFOR cadence

- 8 runs every day, on 32 of 32 days, at `02:30, 04:30, 07:30, 09:30, 11:30, 15:30, 18:30, 22:30` UTC.
- The one deviation was on 2026-01-15, when the 11:30 run was published at 12:25. There were no missing runs. The longest gap between runs is 4h, which is part of the normal schedule.
- Every run has 73 hourly points (1h steps) and ends at 21:00 UTC on day+2. Each run therefore spans the fixed window from 21:00 UTC on the publish day minus 1 to 21:00 UTC on day+2.
  - Lead time ranges from −25.5h to +46.5h for the 22:30 run, and from −5.5h to +66.5h for the 02:30 run.
  - 3,841 of the rows (21%) have a startTime before their publishTime. These are not actuals echoed back: their MAE against FUELHH is about 1,780 MW. Lead-time analysis should drop them.
- The D-1 09:30 run always covers all 24 hours of D, with lead times from 14.5h to 37.5h. D-2 runs stop at 21:00 on D, so they cover only 22 of D's 24 hours.
- External context: Elexon's glossary describes WINDFOR as being "produced at four times of day … 49 values … 21:00 D to 21:00 D+2", which is out of date. The live data shows 8 runs with 73 points each. Glossary: https://www.elexon.co.uk/bsc/glossary/wind-generation-forecast/ (returned 403 to automated fetch; text taken from a search snippet). The current scope and method are UNVERIFIED.

## 2. Alignment of the hourly forecast with the half-hourly actual

Test set: the D-1 09:30 vintage, 744 hours.

| Alignment for forecast hour h             | MAE      | RMSE | bias  |
| ----------------------------------------- | -------- | ---- | ----- |
| (a) actual for the half-hour starting h   | 1996     | 2499 | −1728 |
| (b) mean of the half-hours at h and h+30m | 2013     | 2506 | −1730 |
| (c) mean of the half-hours at h−30m and h | **1975** | 2488 | −1723 |

- Cross-check on all runs at lead times of 0–6h: (a) 1766, (b) 1771, (c) 1751.
- (c) wins in both tests, but the margin is only about 1%. Alignment is a second-order issue next to the bias described below.
- **Recommendation:** show (a), the half-hour starting h, as the simple default ("forecast at 14:00 vs the settlement period 14:00–14:30") and mention (c) in the methodology. Alternatively, use (c) and say so explicitly. Either choice changes MAE by under 25 MW.

## 3. Headline accuracy (D-1 09:30 vintage, alignment c)

| n   | MAE      | RMSE     | Bias (a−f)    | WAPE  | MAPE  |
| --- | -------- | -------- | ------------- | ----- | ----- |
| 744 | 1,975 MW | 2,488 MW | **−1,723 MW** | 17.5% | 21.1% |

- Caveat on MAPE: actual wind never fell below 1.7 GW in this sample, so MAPE does not blow up here (it is 106% on the 5 hours below 2 GW). In other months it would. Use WAPE (Σ|e| / Σactual) or MAE in the UI.
- Correlation between forecast and actual is 0.933. The forecast shape is good but its level is wrong.
- Mean forecast was 13,013 MW against a mean actual of 11,290 MW, so actuals summed to 0.868 × forecast.
- 84.8% of hours were over-forecast, and 27 of 31 days had a negative daily bias.
- OLS fit: actual = 848 + 0.802 × forecast.
- Best day: 2026-01-19, with an MAE of 694 MW. Worst day: 2026-01-28, with an MAE of 5,292 MW.
- Bias by hour of day ranges from −1,285 to −2,255 MW and is negative in every hour.

### SURPRISE: large systematic over-forecast that grows with level

- The bias is roughly proportional to the forecast:
  - about −0.26 GW below a 5 GW forecast
  - −2.4 GW at 15–20 GW
  - −4.6 GW above a 20 GW forecast
- The actual maximum in January was 17.8 GW, while forecasts went up to 21.4 GW. In the 162 hours with a D-1 forecast of 18 GW or more, actual averaged 15.8 GW and never exceeded 17.7 GW.
- Two plausible explanations, both UNVERIFIED:
  1. **Curtailment.** FUELHH is metered output after balancing-mechanism turn-down. Scottish wind is curtailed mainly in high-wind hours, which are the same hours where this gap is largest. Industry analysis reports that 98% of curtailed volume in 2025 came from turning down Scottish wind (SmartestEnergy, https://www.smartestenergy.com/en_GB/insights/the-informer/cost-of-curtailment-hits-1bn/). WINDFOR may instead forecast unconstrained output.
  2. **Coverage mismatch.** WINDFOR may cover a broader set of wind farms than the transmission-metered BM units counted in FUELHH.
- The ceiling-like behaviour near 17–18 GW supports explanation 1. Neither explanation was verified against BOALF/BOD volumes.
- **Open check:** sum wind BM-unit bid acceptances (BOALF) for the worst hours, for example 2026-01-12 00:00–06:00.
- **App implication:** this bias is the most valuable insight for the buying team. Present it as "WINDFOR systematically over-states delivered wind by ~13%; ~2.4 GW at 15–20 GW forecasts".
- A leave-one-day-out linear de-bias (actual ~ a + b·forecast, fitted on the other 30 days) cuts MAE from **1,975 to 1,203 MW** (−39%) and brings bias to −8 MW.

## 4. Error by lead time (all vintages with lead ≥ 0, delivery window Jan 2–Feb 1)

| Lead   | n     | MAE   | RMSE  | Bias   | WAPE |
| ------ | ----- | ----- | ----- | ------ | ---- |
| 0–12h  | 2,902 | 1,703 | 2,160 | −1,491 | 15%  |
| 12–24h | 2,954 | 1,874 | 2,353 | −1,703 | 17%  |
| 24–36h | 2,976 | 1,989 | 2,465 | −1,716 | 18%  |
| 36–48h | 2,945 | 2,216 | 2,761 | −1,893 | 20%  |
| 48h+   | 2,510 | 2,299 | 2,919 | −1,428 | 20%  |

- MAE rises steadily with lead time, but the floor stays high (1.7 GW even at 0–12h). That floor is the bias, not forecast skill.

## 5. Error spread by forecast level

D-1 09:30 vintage:

| Forecast level | n   | MAE   | Bias   | P10    | P50    | P90    | P90−P10   | P10 of actual/forecast |
| -------------- | --- | ----- | ------ | ------ | ------ | ------ | --------- | ---------------------- |
| <5 GW          | 31  | 1,216 | −257   | −1,631 | −661   | 1,238  | 2,869     | 0.54                   |
| 5–10           | 210 | 1,397 | −784   | −2,525 | −763   | 1,166  | **3,691** | 0.63                   |
| 10–15          | 206 | 1,543 | −1,422 | −2,964 | −1,131 | 156    | 3,121     | 0.77                   |
| 15–20          | 253 | 2,437 | −2,421 | −4,196 | −2,419 | −780   | 3,415     | 0.77                   |
| >20 GW         | 44  | 4,634 | −4,634 | −6,621 | −4,364 | −3,250 | 3,370     | 0.68                   |

All vintages at lead times of 12–48h (larger sample):

- P90−P10 is 2,972 for <5 GW, 3,619 for 5–10, **3,947 for 10–15**, 3,382 for 15–20 and 3,452 for >20 GW.
- Bias by level: −901, −816, −1,395, −2,458 and −4,576.

Does the spread peak at mid levels?

- **Weakly, yes.** The P90−P10 width peaks in the 5–15 GW range, which is consistent with the steep middle of the power curve, and narrows slightly above 15 GW.
- The effect is small (about 15–20%) next to how strongly the bias, or median shift, depends on level.
- Above 15 GW the whole error distribution is negative: P90 is below zero, so even the best case is an over-forecast.
- The UI should show the spread and the shift separately. The shift is the curtailment or coverage explanation.

## 6. Firm-wind buffer, validated by leave-one-day-out (D-1 vintage)

- In-sample buffers:
  - 90% confidence: P10 of (actual − forecast) is −4,196 MW, and P10 of (actual/forecast) is 0.706.
  - 95% confidence: P5 of (actual − forecast) is −5,217 MW, and P5 of (actual/forecast) is 0.597.
- In the leave-one-day-out test, the buffer is fitted on 30 days and tested on the held-out day. Firm = max(0, adjusted forecast).

| Confidence | Method                 | LOO hourly coverage | Days with every hour covered | Mean haircut | Firm as % of forecast |
| ---------- | ---------------------- | ------------------- | ---------------------------- | ------------ | --------------------- |
| 90%        | additive (f + P10 err) | 88.7%               | 74.2%                        | 4,165 MW     | 68.0%                 |
| 90%        | ratio (f × P10 ratio)  | 88.8%               | 77.4%                        | 3,805 MW     | 70.8%                 |
| 90%        | additive per level bin | 88.4%               | 71.0%                        | 3,562 MW     | 72.6%                 |
| 90%        | de-biased + additive   | 89.8%               | –                            | –            | 71.1%                 |
| 95%        | additive               | 93.4%               | 90.3%                        | 5,154 MW     | 60.4%                 |
| 95%        | ratio                  | 94.4%               | 87.1%                        | 5,265 MW     | 59.5%                 |
| 95%        | additive per level bin | 92.6%               | 80.6%                        | 4,768 MW     | 63.4%                 |
| 95%        | de-biased + additive   | 94.5%               | –                            | –            | 61.3%                 |

Takeaways:

- Out-of-sample coverage falls 1–2 points short of nominal, which is the expected optimism of in-sample quantiles. De-biasing gives the most honest coverage: 89.8% and 94.5%.
- The ratio method is the best simple choice: "count on ~71% of the D-1 forecast at 90% confidence".
- Binning by level gives the most firm MW but the weakest coverage, because some bins are thin. That calls for a fallback to the pooled quantile, which the script applies below 30 samples.
- Errors within a day are strongly autocorrelated, so per-day coverage (71–90%) is much lower than per-hour coverage. Bad days are bad all day, for example 2026-01-12 and 2026-01-28. This argues for leave-one-day-out over hourly cross-validation; random hourly splits would leak information between hours of the same day.

## 7. Cutoff sweep: the value of waiting

For each delivery day, the vintage used is the latest run published at or before the cutoff. D-2 runs cover only 22 hours of D (n = 682); D-1 runs cover all 24 (n = 744).

| Cutoff                                         | MAE       | RMSE  | Bias   | P10 err |
| ---------------------------------------------- | --------- | ----- | ------ | ------- |
| D-2 02:30                                      | 2,441     | 3,121 | −1,597 | −5,195  |
| D-2 04:30                                      | 2,485     | 3,187 | −1,672 | −5,010  |
| D-2 07:30                                      | 2,415     | 2,995 | −1,785 | −5,053  |
| D-2 09:30                                      | 2,453     | 3,020 | −1,924 | −5,192  |
| D-2 11:30                                      | 2,305     | 2,835 | −1,878 | −4,358  |
| D-2 15:30                                      | 2,210     | 2,703 | −1,826 | −4,243  |
| D-2 18:30                                      | 2,124     | 2,592 | −1,749 | −4,193  |
| D-2 22:30                                      | 2,095     | 2,585 | −1,794 | −4,203  |
| D-1 02:30                                      | 2,048     | 2,566 | −1,729 | −4,259  |
| D-1 04:30                                      | 1,989     | 2,506 | −1,664 | −4,198  |
| D-1 07:30                                      | 2,004     | 2,487 | −1,741 | −4,126  |
| **D-1 09:30 (last run before the 09:50 gate)** | **1,975** | 2,488 | −1,723 | −4,196  |
| D-1 11:30 (after gate)                         | 1,860     | 2,337 | −1,680 | −3,834  |
| D-1 15:30 (after gate)                         | 1,838     | 2,301 | −1,702 | −3,768  |
| D-1 18:30 (after gate)                         | 1,840     | 2,299 | −1,685 | −3,753  |
| D-1 22:30 (after gate)                         | 1,787     | 2,247 | −1,596 | −3,634  |

- Deciding on the D-1 09:30 run instead of the same time on D-2 cuts MAE by 19% (2,453 → 1,975).
- Within D-1 morning the gain is small and not monotone: 02:30 → 09:30 is −73 MW, and 07:30 is slightly worse than 04:30.
- The 11:30 run, which comes after the auction, would give another 6% (−115 MW). That is the "cost of the gate" the app can show.
- The bias barely moves with cutoff, which again points to a structural cause rather than a weather-forecast one.
- The day-ahead auction close at 09:50 UK on D-1 is the N2EX gate closure (see [market-timing.md](market-timing.md)); the app defaults to the earlier EPEX 09:20 gate.

## 8. Worst hours (D-1 09:30 vintage)

Forecast too high (actual far below forecast). This is the buyer's risk of being left short:

| Delivery hour (UTC) | Run used    | Forecast | Actual | Error  |
| ------------------- | ----------- | -------- | ------ | ------ |
| 2026-01-12 01:00    | 01-11 09:30 | 20,905   | 14,079 | −6,826 |
| 2026-01-12 00:00    | 01-11 09:30 | 20,707   | 13,900 | −6,806 |
| 2026-01-12 02:00    | 01-11 09:30 | 20,886   | 14,110 | −6,776 |
| 2026-01-12 03:00    | 01-11 09:30 | 20,808   | 14,144 | −6,664 |
| 2026-01-12 06:00    | 01-11 09:30 | 20,616   | 13,971 | −6,645 |

- All five fall in a single night of a >20 GW forecast. This looks like curtailment (UNVERIFIED) and makes a good "decision replay" showcase day.

Forecast too low (actual above forecast, a true under-forecast), largest cases:

| Delivery hour (UTC) | Forecast | Actual | Error  |
| ------------------- | -------- | ------ | ------ |
| 2026-01-08 19:00    | 5,913    | 9,532  | +3,619 |
| 2026-01-08 20:00    | 7,264    | 10,406 | +3,142 |
| 2026-01-08 18:00    | 4,734    | 7,370  | +2,636 |
| 2026-01-05 13:00    | 8,197    | 10,530 | +2,332 |
| 2026-01-05 14:00    | 8,049    | 10,336 | +2,288 |

- 2026-01-08 was the lowest-wind day of the month (daily mean 4.5 GW), and the evening ramp up arrived earlier and stronger than forecast. It is a timing error, which is a good second showcase.

## 9. Scale of January wind (FUELHH WIND, Jan 1–31)

| Measure                                 | Value                                     |
| --------------------------------------- | ----------------------------------------- |
| Max (half-hour)                         | 17,805 MW at 2026-01-24 18:00 UTC         |
| Min (half-hour)                         | 1,695 MW at 2026-01-08 12:30 UTC          |
| Mean / median                           | 11,581 / 12,141 MW                        |
| P5 / P95                                | 4,350 / 17,032 MW                         |
| Energy                                  | 8.62 TWh (transmission-metered wind only) |
| Daily mean range                        | 4,528 MW (Jan 8) to 16,409 MW (Jan 27)    |
| Largest half-hour ramp                  | 2,337 MW at 2026-01-15 10:00              |
| Largest day-on-day change in daily mean | 10,649 MW                                 |
| WINDFOR range (all runs)                | 2,250 to 21,353 MW                        |

- FUELHH covers transmission-connected (BM-metered) wind and excludes embedded or distribution-connected wind, according to common BMRS usage. This is UNVERIFIED here: no official Elexon page was retrieved.
- The installed-capacity denominator is UNVERIFIED. The app should not show a capacity-factor figure unless it can cite a capacity source, and should otherwise show MW only.

## 10. Implications for the app

1. Make the bias the headline. "WINDFOR over-states delivered wind by ~13% on average, and by 4–5 GW when it forecasts above 20 GW". It is actionable, it was unexpected, and the data proves it.
2. Offer a de-biased forecast toggle, a leave-one-day-out linear correction that cuts MAE by 39%. This is honest because it is fitted out of sample.
3. Firm wind: the ratio buffer with leave-one-day-out coverage. Report hourly coverage and whole-day coverage, and warn that errors cluster by day.
4. Cutoff sweep: D-2 to D-1 09:30 gives −19%. Show the value forgone after the gate (−6%) as context, not as a choice the trader can make.
5. Replay showcase days: 2026-01-12 (high-wind over-forecast) and 2026-01-08 (low-wind ramp timing).
6. Data handling:
   - Cast the string fields to numbers.
   - Drop WINDFOR rows with negative lead time.
   - Expect the occasional off-schedule run (12:25 on Jan 15).
   - D-2 runs stop at 21:00 on D.

## Sources

- Elexon BMRS Insights API, WINDFOR and FUELHH stream endpoints listed at the top (data retrieved 2026-10-26).
- Elexon glossary, Wind Generation Forecast: https://www.elexon.co.uk/bsc/glossary/wind-generation-forecast/ (403 on fetch; seen via search snippet).
- Elexon CP1381, negative wind forecast values (background only): https://www.elexon.co.uk/change-proposal/cp1381/
- SmartestEnergy, curtailment concentrated in Scottish wind: https://www.smartestenergy.com/en_GB/insights/the-informer/cost-of-curtailment-hits-1bn/
- Crown Estate, how BMRS wind data is formed (FPNs used as the forecast for larger farms; background, UNVERIFIED for the current WINDFOR method): https://www.thecrownestate.co.uk/our-business/marine/offshore-wind/learn-how-the-offshore-wind-map-works
