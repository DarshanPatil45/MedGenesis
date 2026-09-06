import { useMemo, useState } from 'react'
import type { TimelineEvent } from '../../api/types'

const LANE_LABEL: Record<string, string> = {
  measurement: 'Measurement',
  lab_result: 'Labs',
  lifestyle_log: 'Lifestyle',
  screening: 'Screening',
  medication_change: 'Medication',
  note: 'Note',
  care_plan: 'Care plan',
}

// Only the event_type values the backend actually writes
// (app/services/twin.py EVENT_TYPES, plus "screening"/"care_plan" from the
// agent routes) get a dedicated filter chip — never invented categories.
const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'lab_result', label: 'Labs' },
  { key: 'lifestyle_log', label: 'Lifestyle' },
  { key: 'screening', label: 'Screening' },
  { key: 'medication_change', label: 'Medication' },
]

function summarizePayload(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
}

function monthTick(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

export function TimelineHero({ events }: { events: TimelineEvent[] }) {
  const [filter, setFilter] = useState('all')

  const { minTime, maxTime, ticks } = useMemo(() => {
    if (events.length === 0) return { minTime: 0, maxTime: 0, ticks: [] as number[] }
    const times = events.map((e) => new Date(e.recorded_at).getTime())
    const min = Math.min(...times)
    const max = Math.max(...times)
    const span = max - min || 1
    const tickCount = 5
    const t = Array.from({ length: tickCount + 1 }, (_, i) => min + (span * i) / tickCount)
    return { minTime: min, maxTime: max, ticks: t }
  }, [events])

  if (events.length === 0) {
    return <p className="timeline-empty">No events recorded yet — create a patient or load a demo profile on Intake.</p>
  }

  const filtered = filter === 'all' ? events : events.filter((e) => e.event_type === filter)
  const availableFilters = FILTERS.filter(
    (f) => f.key === 'all' || events.some((e) => e.event_type === f.key),
  )

  const lanes = new Map<string, TimelineEvent[]>()
  for (const e of filtered) {
    const list = lanes.get(e.event_type) ?? []
    list.push(e)
    lanes.set(e.event_type, list)
  }

  const span = maxTime - minTime || 1
  const pct = (t: number) => ((t - minTime) / span) * 100

  return (
    <>
      <div className="timeline-controls">
        {availableFilters.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`chip${filter === f.key ? ' selected' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {lanes.size === 0 ? (
        <p className="timeline-empty">No events of this type are on record.</p>
      ) : (
        <>
          {[...lanes.entries()].map(([type, laneEvents]) => (
            <div key={type} className="timeline-lane">
              <span className="timeline-lane-label">{LANE_LABEL[type] ?? type}</span>
              <div className="timeline-lane-track">
                {laneEvents.map((e) => (
                  <span
                    key={e.id}
                    className="timeline-event"
                    style={{ left: `${pct(new Date(e.recorded_at).getTime())}%` }}
                    title={`${new Date(e.recorded_at).toLocaleDateString()} — ${e.event_type}${
                      Object.keys(e.payload).length ? `: ${summarizePayload(e.payload)}` : ''
                    }`}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="timeline-axis">
            {ticks.map((t, i) => (
              <span
                key={i}
                className="timeline-axis-tick"
                style={{ left: `${(i / (ticks.length - 1)) * 100}%` }}
              >
                {monthTick(t)}
              </span>
            ))}
          </div>
        </>
      )}
    </>
  )
}
