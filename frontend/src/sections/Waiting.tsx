import { WaitingCurve } from '../charts/WaitingCurve'
import { Kpi, KpiStrip } from '../components/Kpi'
import { Panel, Section, Split } from '../components/Section'
import { SignalCard } from '../components/SignalCard'
import { Await } from '../components/States'
import { WatchList } from '../components/WatchList'
import { useWaiting } from '../hooks/queries'
import type { Waiting as WaitingData } from '../lib/api'
import { gw, gwRange, signedGw } from '../lib/format'

type AuctionId = WaitingData['gates'][number]['auction']

const slotName = (s: { day_offset: number; local_time: string }) => `D-${-s.day_offset} ${s.local_time}`
const spansZero = (ci: { lo: number; hi: number }) => ci.lo <= 0 && ci.hi >= 0

function Body({ w, auction }: { w: WaitingData; auction: AuctionId }) {
  const byId = new Map(w.slots.map((s) => [s.id, s]))
  const gate = w.gates.find((g) => g.auction === auction) ?? w.gates[0]!
  const gain = w.gains.find((g) => g.auction === gate.auction)
  const gateSlot = byId.get(gate.last_slot_id)!
  const after = w.slots.filter((s) => s.post_gate[gate.auction])
  const best = after.reduce<typeof gateSlot | undefined>((b, s) => (!b || s.mae.value < b.mae.value ? s : b), undefined)
  const label = gate.auction.toUpperCase()
  const biases = w.slots.map((s) => s.bias)
  const ad = w.auction_diff
  const from = gain && slotName(byId.get(gain.from_slot)!)

  return (
    <>
      <KpiStrip>
        {/* Differences are "change in typical miss", so a negative value reads as the improvement it is. */}
        <Kpi
          label="Change from waiting"
          value={gain ? signedGw(gain.diff.value, 2) : '–'}
          sub={
            gain &&
            `typical miss, ${from} → ${slotName(byId.get(gain.to_slot)!)} · CI ${gwRange(gain.diff.lo, gain.diff.hi, 2)}`
          }
        />
        <Kpi
          label={`Typical miss at the ${label} gate`}
          value={gw(gateSlot.mae.value, 2)}
          sub={`${slotName(gateSlot)} run, last before ${gate.local_time}`}
        />
        <Kpi
          label="Best later run vs gate"
          value={best ? signedGw(best.mae.value - gateSlot.mae.value, 2) : '–'}
          sub={best ? `change in typical miss (${slotName(best)}), not available day-ahead` : undefined}
        />
        <Kpi label="N2EX vs EPEX" value={signedGw(ad.value, 2)} sub={`change in typical miss · CI ${gwRange(ad.lo, ad.hi, 2)}`} />
      </KpiStrip>
      <Split
        main={
          <Panel
            eyebrow="Typical miss by forecast run"
            title={
              gain && gain.diff.value < 0
                ? `Later runs are usually better: waiting from ${from} to the gate cuts typical miss by ${gw(-gain.diff.value)}`
                : 'Typical miss of each run, up to the gate and after'
            }
            foot={`Every run from D-2 02:30 to D-1 22:30, scored on the same ${w.common_hours} hours (the ones every run covers; D-2 runs stop at 21:00 on D). Shaded: published after the gate, not available day-ahead.`}
          >
            <WaitingCurve slots={w.slots} gates={w.gates} gain={gain} />
          </Panel>
        }
        rail={
          <>
            <SignalCard title="Which auction you trade changes your forecast">
              <p>
                An N2EX buyer (09:50 gate) gets the 09:30 run; an EPEX buyer (09:20) works off the 07:30 run. Over January that
                changed typical miss by {signedGw(ad.value, 2)} (90% CI {gwRange(ad.lo, ad.hi, 2)})
                {spansZero(ad) ? ', too small to tell apart from zero.' : '.'}
              </p>
            </SignalCard>
            <WatchList
              items={[
                best &&
                  best.mae.value < gateSlot.mae.value &&
                  `Runs after the gate would cut typical miss by up to ${gw(gateSlot.mae.value - best.mae.value, 2)}. That is the cost of trading day-ahead; intraday re-trading is the next step.`,
                `The bias barely moves with timing (over by ${gwRange(-Math.max(...biases), -Math.min(...biases))} across runs): a structural gap, not weather uncertainty.`,
              ].filter((x): x is string => !!x)}
            />
          </>
        }
      />
    </>
  )
}

export function Waiting({ auction }: { auction: AuctionId }) {
  const waiting = useWaiting()
  return (
    <Section
      id="waiting"
      letter="D"
      eyebrow="Value of waiting"
      title="When should we decide?"
      lede="Each run's typical miss on like-for-like hours, from two days out to the last run before delivery."
    >
      <Await query={waiting} height={480}>
        {(w) => <Body w={w} auction={auction} />}
      </Await>
    </Section>
  )
}
