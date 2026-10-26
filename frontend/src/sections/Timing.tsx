import { WaitingCurve } from '../charts/WaitingCurve'
import { Kpi, KpiStrip } from '../components/Kpi'
import { Notes } from '../components/Notes'
import { Panel, Section, Split } from '../components/Section'
import { Await } from '../components/States'
import { useWaiting } from '../hooks/queries'
import type { Waiting as WaitingData } from '../lib/api'
import { delta, gw, gwRange, mwRange } from '../lib/format'

type AuctionId = WaitingData['gates'][number]['auction']

const slotName = (s: { day_offset: number; local_time: string }) => `D-${-s.day_offset} ${s.local_time}`
const spansZero = (ci: { lo: number; hi: number }) => ci.lo <= 0 && ci.hi >= 0

function Body({ w, auction }: { w: WaitingData; auction: AuctionId }) {
  const byId = new Map(w.slots.map((s) => [s.id, s]))
  const gate = w.gates.find((g) => g.auction === auction) ?? w.gates[0]!
  const gain = w.gains.find((g) => g.auction === gate.auction)
  const gateSlot = byId.get(gate.last_slot_id)!
  const after = w.slots.filter((s) => s.post_gate[gate.auction])
  const best = after.reduce<typeof gateSlot | undefined>(
    (b, s) => (!b || s.mae.value < b.mae.value ? s : b),
    undefined,
  )
  const label = gate.auction.toUpperCase()
  const biases = w.slots.map((s) => s.bias)
  const ad = w.auction_diff
  const from = gain && slotName(byId.get(gain.from_slot)!)
  const epex = w.gates.find((g) => g.auction === 'epex')
  const n2ex = w.gates.find((g) => g.auction === 'n2ex')
  const runOf = (g: typeof epex) => (g ? byId.get(g.last_slot_id)?.local_time : undefined)

  return (
    <>
      <div className="finding" role="note">
        <p className="finding-kicker">Finding</p>
        <p className="finding-head">
          {spansZero(ad)
            ? 'The auction choice barely matters.'
            : 'The later auction gets a measurably better forecast.'}
        </p>
        <p className="finding-body">
          N2EX ({n2ex?.local_time}) gets the {runOf(n2ex)} run; EPEX ({epex?.local_time}) the {runOf(epex)}{' '}
          run. Over January N2EX's later run {ad.value <= 0 ? 'cut' : 'raised'} mean absolute error by{' '}
          <strong>{delta(ad.value)}</strong> (90% range{' '}
          {ad.value <= 0 ? mwRange(-ad.hi, -ad.lo) : mwRange(ad.lo, ad.hi)})
          {spansZero(ad) ? ': too small to tell from zero.' : '.'}
        </p>
      </div>
      <KpiStrip>
        {/* Direction in words, size without a sign: a minus would read as a loss. */}
        <Kpi
          label={!gain || gain.diff.value <= 0 ? 'Error saved by waiting' : 'Error added by waiting'}
          hint="mean absolute error, two days out vs the gate"
          value={gain ? delta(gain.diff.value) : '–'}
          sub={
            gain &&
            `${from} → ${slotName(byId.get(gain.to_slot)!)} · 90% range ${
              gain.diff.value <= 0
                ? mwRange(-gain.diff.hi, -gain.diff.lo)
                : mwRange(gain.diff.lo, gain.diff.hi)
            }`
          }
        />
        <Kpi
          label={`Error at the ${label} gate`}
          hint="mean absolute error of the run used"
          value={gw(gateSlot.mae.value)}
          sub={`${slotName(gateSlot)} run, last before ${gate.local_time}`}
        />
        <Kpi
          label="Error saved by the best later run"
          hint="not available day-ahead"
          value={
            best && best.mae.value < gateSlot.mae.value ? delta(gateSlot.mae.value - best.mae.value) : '–'
          }
          sub={best ? `${slotName(best)} run, after the gate` : undefined}
        />
      </KpiStrip>
      <Split
        main={
          <Panel
            title={
              gain && gain.diff.value < 0
                ? `Value of waiting: from ${from} to the gate, error falls by ${delta(gain.diff.value)}`
                : 'Value of waiting: error of each run, up to the gate and after'
            }
            hint={`Every run from D-2 02:30 to D-1 22:30, scored on the same ${w.common_hours} hours (the ones every run covers). Shaded: published after both gates.`}
          >
            <WaitingCurve slots={w.slots} gates={w.gates} gain={gain} />
          </Panel>
        }
        rail={
          <Notes
            title="What it means"
            items={[
              ...(best && best.mae.value < gateSlot.mae.value
                ? [
                    {
                      title: 'The cost of trading day-ahead',
                      text: `Runs after the gate would cut the error by up to ${delta(gateSlot.mae.value - best.mae.value)}. Intraday re-trading is where that is won back.`,
                    },
                  ]
                : []),
              {
                title: 'Timing does not fix the bias',
                text: `Every run is too high by ${gwRange(-Math.max(...biases), -Math.min(...biases))}: a structural gap, not weather uncertainty.`,
              },
            ]}
          />
        }
      />
    </>
  )
}

export function Timing({ auction }: { auction: AuctionId }) {
  const waiting = useWaiting()
  return (
    <Section
      id="timing"
      title="Timing"
      lede="Does waiting for a later forecast run pay? Each run's error on like-for-like hours, from two days out to the last run before delivery."
    >
      <Await query={waiting} height={480}>
        {(w) => <Body w={w} auction={auction} />}
      </Await>
    </Section>
  )
}
