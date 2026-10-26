import type { components, operations } from './api-types'

type S = components['schemas']
export type Meta = S['Meta']
export type Replay = S['Replay']
export type Accuracy = S['Accuracy']
export type Firm = S['Firm']
export type FirmDay = S['FirmDay']
export type Waiting = S['Waiting']
export type Live = S['Live']
export type Sig = S['Sig']
export type CI = S['CI']
export type SourceStatus = S['SourceStatus']
export type SourceState = SourceStatus['state']
export type Calib = S['Params']['calib']
export type ExportView = operations['export_csv_api_v1_export_csv_get']['parameters']['query']['view']

type Query<Op extends keyof operations> = NonNullable<operations[Op]['parameters']['query']>
export type ReplayQuery = Query<'replay_api_v1_replay_get'>
export type AnalysisQuery = Query<'accuracy_api_v1_accuracy_get'>
export type LiveQuery = Query<'live_api_v1_live_get'>
export type ExportQuery = Query<'export_csv_api_v1_export_csv_get'>

const BASE = '/api/v1'

export class ApiError extends Error {
  readonly status: number
  readonly field: string | null

  constructor(status: number, message: string, field: string | null = null) {
    super(message)
    this.status = status
    this.field = field
  }
}

function url(path: string, params: object = {}): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v))
  const s = qs.toString()
  return `${BASE}${path}${s ? `?${s}` : ''}`
}

async function get<T>(path: string, params?: object, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(url(path, params), { signal, headers: { Accept: 'application/json' } })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new ApiError(0, "Couldn't reach the server. Check your connection and try again.")
  }
  if (res.ok) return (await res.json()) as T
  // Prefer the API's ErrorBody; a proxy or platform error page (or a server bug's 500) will not parse.
  const body = (await res.json().catch(() => null)) as S['ErrorBody'] | null
  if (body?.error) throw new ApiError(res.status, body.error.message, body.error.field ?? null)
  throw new ApiError(res.status, `The server didn't respond (${res.status}). Try again in a moment.`)
}

export const api = {
  meta: (signal?: AbortSignal) => get<Meta>('/meta', undefined, signal),
  source: (signal?: AbortSignal) => get<SourceStatus>('/source', undefined, signal),
  replay: (q: ReplayQuery, signal?: AbortSignal) => get<Replay>('/replay', q, signal),
  accuracy: (q: AnalysisQuery, signal?: AbortSignal) => get<Accuracy>('/accuracy', q, signal),
  firm: (q: AnalysisQuery, signal?: AbortSignal) => get<Firm>('/firm', q, signal),
  waiting: (v: string, signal?: AbortSignal) => get<Waiting>('/waiting', { v }, signal),
  live: (q: LiveQuery, signal?: AbortSignal) => get<Live>('/live', q, signal),
}

export const exportUrl = (q: ExportQuery): string => url('/export.csv', q)
