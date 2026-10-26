import { scaleLinear } from 'd3-scale'
import type { LevelBin } from '../lib/api'
import { gw, signedGw } from '../lib/format'
import { ChartFrame, gwTick, Key, TipRow } from './ChartFrame'

interface Props {
  bins: LevelBin[]
  ceilingMw: number
}

// Errors arrive as actual − forecast; the chart plots their negation so "forecast too high" points up.
const over = (v: number | null) => (v == null ? null : -v)

interface Range {
  lo: number | null // over-forecast P10 (= −error P90)
  mid: number | null
  hi: number | null
}

export function LevelBias({ bins, ceilingMw }: Props) {
  const spans = bins.map((b, i) => {
    const prev = bins[i - 1]
    // The top bin is open-ended; draw it as wide as its neighbour.
    const width = b.hi_mw != null ? b.hi_mw - b.lo_mw : prev?.hi_mw != null ? prev.hi_mw - prev.lo_mw : 5000
    const raw: Range = { lo: over(b.raw_p90), mid: over(b.raw_p50), hi: over(b.raw_p10) }
    const corr: Range = { lo: over(b.corr_p90), mid: over(b.corr_p50), hi: over(b.corr_p10) }
    return { bin: b, x0: b.lo_mw, x1: b.lo_mw + width, raw, corr }
  })
  const values = spans
    .flatMap((s) => [s.raw.lo, s.raw.hi, s.corr.lo, s.corr.hi])
    .filter((v): v is number => v != null)
  const yDomain = scaleLinear()
    .domain([Math.min(0, ...values), Math.max(0, ...values)])
    .nice()
    .domain() as [number, number]
  const xDomain: [number, number] = [spans[0]?.x0 ?? 0, spans.at(-1)?.x1 ?? 25000]
  const centres = spans.map((s) => (s.x0 + s.x1) / 2)
  const top = spans.at(-1)

  const tooltip = (i: number) => {
    const s = spans[i]
    if (!s) return null
    return (
      <>
        <div className="chart-tip-title">
          Forecast {s.bin.label} · {s.bin.n} h
        </div>
        <TipRow
          className="s-raw"
          label={`forecast, middle 80% ${signedGw(s.raw.lo)} to ${signedGw(s.raw.hi)}`}
          value={signedGw(s.raw.mid)}
        />
        <TipRow
          className="s-corrected"
          label={`corrected, middle 80% ${signedGw(s.corr.lo)} to ${signedGw(s.corr.hi)}`}
          value={signedGw(s.corr.mid)}
        />
      </>
    )
  }

  return (
    <ChartFrame
      ariaLabel={`Forecast minus actual wind by forecast level, median and middle 80% of hours per level, before and after correction.${
        top
          ? ` For forecasts of ${top.bin.label} the median over-forecast was ${gw(top.raw.mid)} before correction and ${gw(top.corr.mid)} after.`
          : ''
      } Actual wind never exceeded ${gw(ceilingMw)}.`}
      xDomain={xDomain}
      yDomain={yDomain}
      xTicks={(_, width) =>
        // Narrow bins drop the repeated unit; the axis title carries it.
        spans.map((s, i) => ({
          value: centres[i] ?? 0,
          label: width / spans.length < 80 ? s.bin.label.replace(' GW', '') : s.bin.label,
        }))
      }
      yFormat={(v) => gwTick(v, true)}
      yLabel="Forecast minus actual, GW (+ = forecast too high)"
      snap={centres}
      tooltip={tooltip}
      legend={
        <>
          <Key mark="area" className="bar-raw" label="Forecast, middle 80% of hours" />
          <Key mark="area" className="bar-corrected" label="Corrected forecast, middle 80%" />
          <Key mark="line" className="median" label="Median" />
          <Key mark="area" className="post-gate" label="Actual wind never reached" />
        </>
      }
    >
      {({ x, y, height }) => {
        const bar = (cx: number, r: Range, cls: string, w: number) =>
          r.lo != null &&
          r.hi != null && (
            <g key={cls}>
              <rect
                className={cls}
                x={cx - w / 2}
                width={w}
                y={y(r.hi)}
                height={Math.max(1, y(r.lo) - y(r.hi))}
                rx={3}
              />
              {r.mid != null && (
                <line
                  className="median"
                  x1={cx - w / 2 - 2}
                  x2={cx + w / 2 + 2}
                  y1={y(r.mid)}
                  y2={y(r.mid)}
                />
              )}
            </g>
          )
        // Levels wholly above the highest actual hour: the forecast went there, the wind never did.
        const unreached = spans.filter((s) => s.x0 >= ceilingMw)
        return (
          <>
            {unreached.map((s) => (
              <g key={s.bin.label}>
                <rect className="post-gate" x={x(s.x0)} width={x(s.x1) - x(s.x0)} height={height} />
                {x(s.x1) - x(s.x0) > 130 && (
                  <text
                    className="direct-label"
                    x={(x(s.x0) + x(s.x1)) / 2}
                    y={height - 8}
                    textAnchor="middle"
                  >
                    Actual never reached
                  </text>
                )}
              </g>
            ))}
            <line className="zero" x2={x(xDomain[1])} y1={y(0)} y2={y(0)} />
            {spans.map((s, i) => {
              const c = x(centres[i] ?? 0)
              const w = Math.min(24, (x(s.x1) - x(s.x0)) * 0.3)
              return (
                <g key={s.bin.label}>
                  {bar(c - w / 2 - 1, s.raw, 'bar-raw', w)}
                  {bar(c + w / 2 + 1, s.corr, 'bar-corrected', w)}
                </g>
              )
            })}
          </>
        )
      }}
    </ChartFrame>
  )
}
