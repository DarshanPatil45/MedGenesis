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
import { Card, ErrorNote } from '../components/common'

const TRACKED = [
  { key: 'phys_hlth', color: '#b4322c', label: 'Days of poor physical health (last 30)' },
  { key: 'bmi', color: '#1d6fa5', label: 'BMI' },
  { key: 'weight_kg', color: '#1f8a5f', label: 'Weight (kg)' },
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
      <h1>Digital Twin Timeline</h1>
      <p className="muted">
        Every measurement, lifestyle log, screening and care plan is an immutable, timestamped
        event. Nothing is ever overwritten — the patient's "current state" below is computed by
        folding the log, so every output stays traceable to the exact state it came from.
      </p>
      <ErrorNote error={error} />
      {loading && <p className="muted">Loading…</p>}

      {chartData.length > 1 && (
        <Card title="Measurements over time">
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e6ebf2" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Legend />
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
        </Card>
      )}

      <Card title="Current state (materialized view)">
        <dl className="kv">
          {Object.entries(timeline?.current_state ?? {}).map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title={`Event log (${timeline?.events.length ?? 0} events, append-only)`}>
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Source</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            {[...(timeline?.events ?? [])].reverse().map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.recorded_at).toLocaleString()}</td>
                <td>
                  <span className="badge neutral">{e.event_type}</span>
                </td>
                <td className="muted">{e.source}</td>
                <td>
                  <code style={{ fontSize: '0.76rem' }}>
                    {Object.entries(e.payload)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(', ')}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
    </>
  )
}
