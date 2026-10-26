import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, type Calib, type Live } from '../lib/api'
import { ukMidnight } from '../lib/format'

export interface AnalysisParams {
  cutoff: string
  margin: number
  calib: Calib
}

/** The snapshot check runs inline on /source (serverless can't finish background work), so it is
 * fetched separately and merged into meta: the page renders immediately while the badge catches up. */
export function useMeta() {
  const meta = useQuery({ queryKey: ['meta'], queryFn: ({ signal }) => api.meta(signal) })
  const source = useQuery({
    queryKey: ['source'],
    queryFn: ({ signal }) => api.source(signal),
    enabled: !!meta.data,
    staleTime: 5 * 60_000,
    retry: 1,
  })
  if (!meta.data) return meta
  if (source.data) return { ...meta, data: { ...meta.data, source: source.data } }
  if (source.isError)
    return { ...meta, data: { ...meta.data, source: { state: 'unreachable' as const, checked_at: null } } }
  return meta
}

// Every January key carries the data hash, so a new snapshot can never be served from a stale cache entry,
// and `v` busts the CDN the same way. The previous result stays on screen while new parameters load.
const useHash = () => useMeta().data?.data_hash

export function useReplay(day: string | undefined, p: AnalysisParams) {
  const v = useHash()
  return useQuery({
    queryKey: ['replay', v, day, p.cutoff, p.margin, p.calib],
    queryFn: ({ signal }) => api.replay({ day: day!, ...p, v }, signal),
    enabled: !!v && !!day,
    placeholderData: keepPreviousData,
  })
}

export function useAccuracy(p: AnalysisParams, enabled = true) {
  const v = useHash()
  return useQuery({
    queryKey: ['accuracy', v, p.cutoff, p.margin, p.calib],
    queryFn: ({ signal }) => api.accuracy({ ...p, v }, signal),
    enabled: !!v && enabled,
    placeholderData: keepPreviousData,
  })
}

export function useFirm(p: AnalysisParams, enabled = true) {
  const v = useHash()
  return useQuery({
    queryKey: ['firm', v, p.cutoff, p.margin, p.calib],
    queryFn: ({ signal }) => api.firm({ ...p, v }, signal),
    enabled: !!v && enabled,
    placeholderData: keepPreviousData,
  })
}

export function useWaiting() {
  const v = useHash()
  return useQuery({
    queryKey: ['waiting', v],
    queryFn: ({ signal }) => api.waiting(v!, signal),
    enabled: !!v,
    placeholderData: keepPreviousData,
  })
}

/** How long a live answer holds: an unavailable one is retried at the server's 60 s cache lifetime; an ok one until
 * the gate (the run used becomes final) or UK midnight (a new "tomorrow"), at most 30 min. A few seconds' slack
 * lands the refetch after the CDN copy, which expires at the same moment, has gone. */
export function liveTtl(d: Live, now = Date.now()): number {
  if (d.status === 'unavailable') return 60_000
  const next = Math.min(ukMidnight(d.target_day), d.gate_passed ? Infinity : Date.parse(d.cutoff_utc))
  return Math.min(30 * 60_000, Math.max(5_000, next - now + 5_000))
}

/** Live data moves, so it is polled on its own lifetime instead of keyed by the hash. */
export function useLive(cutoff: string, margin: number) {
  return useQuery({
    queryKey: ['live', cutoff, margin],
    queryFn: ({ signal }) => api.live({ cutoff, margin }, signal),
    staleTime: (q) => (q.state.data ? liveTtl(q.state.data, q.state.dataUpdatedAt) : 0),
    refetchInterval: (q) => (q.state.data ? liveTtl(q.state.data, q.state.dataUpdatedAt) : false),
    placeholderData: keepPreviousData,
  })
}
