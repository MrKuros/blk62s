// Layout data for the gate timeline: every forecast run published from D-2 00:00 to D 24:00 (UK), the gate, and the
// delivery day, as epoch ms. Pure, so the chart only maps it to pixels.
import type { Replay } from './api'
import { addDays, ukMidnight, ukWallTime } from './format'

const HOUR = 3_600_000

export interface TimelineRun {
  publish: number
  tooLate: boolean
  used: boolean
  /** Mean change vs the previous run over the hours both cover, MW; null for the first run. */
  revisionMw: number | null
  leadMin: number | null
  leadMax: number | null
}

export interface GateTimeline {
  start: number
  end: number
  deliveryStart: number
  /** UK midnights of D-2, D-1, D and D+1 (days can be 23 or 25 h). */
  dayStarts: [number, number, number, number]
  /** Gate closure minus the data-latency margin: runs at or after it are too late. */
  gate: number
  runs: TimelineRun[]
}

export function gateTimeline(d: Replay): GateTimeline {
  const day = d.params.day ?? d.hours[0]?.t.slice(0, 10) ?? ''
  const hours = d.hours.map((h) => Date.parse(h.t))
  const used = d.decision_run?.publish_time
  const sorted = [...d.runs].sort((a, b) => Date.parse(a.publish_time) - Date.parse(b.publish_time))
  const runs = sorted.map((run, k): TimelineRun => {
    const publish = Date.parse(run.publish_time)
    const prev = sorted[k - 1]
    let sum = 0
    let n = 0
    if (prev)
      run.values.forEach((v, i) => {
        const p = prev.values[i]
        if (v == null || p == null) return
        sum += v - p
        n++
      })
    const covered = hours.filter((_, i) => run.values[i] != null)
    const lead = (t: number | undefined) => (t === undefined ? null : (t - publish) / HOUR)
    return {
      publish,
      tooLate: run.too_late,
      used: run.publish_time === used,
      revisionMw: n ? sum / n : null,
      leadMin: lead(covered[0]),
      leadMax: lead(covered.at(-1)),
    }
  })
  const dayStarts = [-2, -1, 0, 1].map((n) => ukMidnight(addDays(day, n))) as GateTimeline['dayStarts']
  return {
    start: dayStarts[0],
    end: dayStarts[3],
    deliveryStart: dayStarts[2],
    dayStarts,
    gate: ukWallTime(addDays(day, -1), d.params.cutoff_local) - d.params.margin * 60_000,
    runs,
  }
}
