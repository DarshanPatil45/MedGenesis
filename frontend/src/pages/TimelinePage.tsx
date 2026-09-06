import { History, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api/client'
import type { Timeline } from '../api/types'
import { usePatients } from '../PatientContext'
import { ErrorNote } from '../components/common'
import { TimelineHero } from '../components/timeline/TimelineHero'

// Cosmetic only — reformats the backend's raw snake_case field name for
// display. Never reinterprets the value.
function humanizeFieldName(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

const HEADLINE_KEYS = ['bmi', 'weight_kg', 'gen_hlth']

const TRACKED = [
  { key: 'phys_hlth', color: 'var(--high)', label: 'Days of poor physical health (last 30)' },
  { key: 'bmi', color: 'var(--brand)', label: 'BMI' },
  { key: 'weight_kg', color: 'var(--low)', label: 'Weight (kg)' },
]

export function TimelinePage() {
  const { selected } = usePatients()
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (patientId: number) => {
    setLoading(true)
    try {
      setTimeline(await api.timeline(patientId))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selected) void load(selected.id)
  }, [selected, load])

  if (!selected) return <p className="muted">Select a patient on the Intake page first.</p>

  const currentState = timeline?.current_state ?? {}
  const stateEntries = Object.entries(currentState)
  const headlineEntries = stateEntries.filter(([k]) => HEADLINE_KEYS.includes(k))
  const displayEntries = headlineEntries.length > 0 ? headlineEntries : stateEntries.slice(0, 3)

  const recentEvents = [...(timeline?.events ?? [])]
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
    .slice(0, 12)

  const chartData =
    timeline?.events
      .filter((e) => e.event_type === 'measurement')
      .map((e) => ({
        date: new Date(e.recorded_at).toLocaleDateString(),
        phys_hlth: e.payload.phys_hlth as number | undefined,
        bmi: e.payload.bmi as number | undefined,
        weight_kg: e.payload.weight_kg as number | undefined,
      })) ?? []

  return (
    <>
      <div className="section-block">
        <span className="eyebrow">
          <Sparkles /> Longitudinal patient intelligence
        </span>
        <h1 className="section-title">Digital Twin</h1>
        <p className="section-lead">
          Every measurement, lifestyle log, screening and care plan is an immutable, timestamped
          event. Nothing is ever overwritten — the state below is computed by folding that
          append-only log.
        </p>
      </div>
      <ErrorNote error={error} />
      {loading && <p className="muted">Loading…</p>}

      <div className="bento">
        <div className="bento-panel">
          <span className="bento-panel-label">Patient snapshot</span>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: '1.6rem', fontWeight: 700 }}>
            {selected.age}
          </div>
          <div className="muted" style={{ textTransform: 'capitalize' }}>
            {selected.sex}
          </div>
          <div className="muted" style={{ fontSize: '0.78rem', marginTop: 'var(--space-2)' }}>
            {selected.pseudonym}
          </div>
        </div>
        <div className="bento-panel">
          <span className="bento-panel-label">Current state</span>
          {displayEntries.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No recorded state yet.</p>
          ) : (
            <dl className="kv">
              {displayEntries.map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{humanizeFieldName(k)}</dt>
                  <dd>{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      {chartData.length > 1 && (
        <div className="section-block">
          <span className="micro-label">Measurements over time</span>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" fontSize={12} stroke="var(--muted)" />
                <YAxis fontSize={12} stroke="var(--muted)" />
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface-solid)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: '0.82rem',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                {TRACKED.map((t) => (
                  <Line
                    key={t.key}
                    type="monotone"
                    dataKey={t.key}
                    name={t.label}
                    stroke={t.color}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="timeline-hero">
        <div className="section-block" style={{ marginBottom: 'var(--space-4)' }}>
          <span className="micro-label" style={{ marginBottom: 0 }}>
            Longitudinal patient state
          </span>
        </div>
        <TimelineHero events={timeline?.events ?? []} />
      </div>

      <div className="section-block">
        <span className="micro-label">
          Event stream ({timeline?.events.length ?? 0} events, append-only)
        </span>
        {recentEvents.length === 0 ? (
          <p className="muted">No events recorded yet.</p>
        ) : (
          <div className="event-stream">
            {recentEvents.map((e) => (
              <div key={e.id} className="event-stream-row">
                <span className="event-stream-date">{new Date(e.recorded_at).toLocaleDateString()}</span>
                <span className="badge neutral">{e.event_type}</span>
                <span className="muted" style={{ flex: 1 }}>
                  {Object.entries(e.payload)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ') || '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="card">
        <summary className="row" style={{ gap: '0.5rem' }}>
          <History size={15} style={{ color: 'var(--brand)' }} /> View materialized state (raw)
        </summary>
        <div className="details-body">
          <dl className="kv">
            {stateEntries.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </details>
    </>
  )
}
