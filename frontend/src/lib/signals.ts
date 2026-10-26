// Sentences for the backend's deterministic signals (`app/signals.py`). Text lives here, numbers come from the API.
import type { Sig } from './api'
import { gw, signedGw, ukDateTime, ukTime } from './format'

export interface SignalText {
  title: string
  text: string
}

type Params = Sig['params']

const num = (p: Params, k: string): number | null => (typeof p[k] === 'number' ? (p[k] as number) : null)
const str = (p: Params, k: string): string | null => (typeof p[k] === 'string' ? (p[k] as string) : null)

const RULES: Record<string, (p: Params) => SignalText | null> = {
  above_ceiling: (p) => {
    const hours = num(p, 'hours')
    const ceiling = num(p, 'ceiling_mw')
    if (hours == null || ceiling == null) return null
    return {
      title: 'Forecast is above anything delivered',
      text: `The forecast tops ${gw(ceiling)} for ${hours} h. Delivered wind hadn't exceeded ${gw(ceiling)} in any hour known at the gate, so treat the top of this forecast as unlikely.`,
    }
  },
  revision: (p) => {
    const delta = num(p, 'delta_mw')
    if (delta == null) return null
    const prev = str(p, 'prev_publish')
    return {
      title: delta < 0 ? 'Latest run revised down' : 'Latest run revised up',
      text: `The decision run is ${signedGw(delta)} on average vs the ${prev ? `${ukTime(prev)} ` : 'previous '}run. A big revision this close to the gate often means the weather picture is still moving.`,
    }
  },
  correction: (p) => {
    const v = num(p, 'mw')
    if (v == null) return null
    return {
      title: v >= 0 ? 'Correction lowers the forecast' : 'Correction raises the forecast',
      text: `Learned from earlier days, the correction moves this forecast ${v >= 0 ? 'down' : 'up'} by ${gw(Math.abs(v))} on average. The forecast has run high at these levels.`,
    }
  },
  calibrating: (p) => {
    const n = num(p, 'train_days')
    if (n == null) return null
    return {
      title: 'Still calibrating',
      text: `Only ${n} past ${n === 1 ? 'day was' : 'days were'} known at the gate (5 needed), so this day shows the raw forecast with no correction or band.`,
    }
  },
  run_jump: (p) => {
    const runs = num(p, 'runs')
    const since = str(p, 'since')
    if (runs == null || since == null) return null
    return {
      title: 'Forecast has stopped updating',
      text: `The decision run repeats the ${runs - 1} runs before it exactly, unchanged since ${ukDateTime(since)}. The NESO feed looks frozen, so every number here is stale: check for a data fault before relying on it.`,
    }
  },
}

/** Title and sentence for a signal; null for an unknown id or missing params. */
export function signalText(sig: Sig | null | undefined): SignalText | null {
  if (!sig) return null
  return RULES[sig.id]?.(sig.params) ?? null
}
