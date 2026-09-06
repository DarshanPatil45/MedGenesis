import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DigitalTwin as DigitalTwinData, LabTrend } from '../../api/types'

// Cosmetic only — the backend's raw snake_case field name, reformatted for
// display. Never reinterprets or relabels what the value means (e.g. never
// turns a 0/1 into "Yes"/"No"), since that would be a frontend judgment
// about clinical meaning, not a formatting change.
function humanizeFieldName(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export function DigitalTwin({ twin, hba1c }: { twin: DigitalTwinData | null; hba1c: LabTrend | null }) {
  const hba1cChartData = (hba1c?.history ?? []).map((h) => ({
    date: new Date(h.recorded_at).toLocaleDateString(),
    value: h.value,
  }))

  return (
    <>
      {!twin ? (
        <p className="muted">Digital Twin view unavailable for this patient right now.</p>
      ) : (
        <>
          <h3 style={{ marginTop: 0 }}>Health & lifestyle</h3>
          <div className="metric-grid">
            {Object.entries({ ...twin.clinical, ...twin.lifestyle }).map(([k, v]) => (
              <div key={k} className="metric-tile">
                <span className="metric-label">{humanizeFieldName(k)}</span>
                <span className="metric-value">{String(v)}</span>
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: '1rem' }}>Recent activity</h3>
          {twin.medications.current.length === 0 ? (
            <p className="muted">No current medications on record.</p>
          ) : (
            <ul className="mini-timeline">
              {twin.medications.current.map((m, i) => (
                <li key={i}>
                  <span className="mini-timeline-date">
                    {new Date(m.recorded_at).toLocaleDateString()}
                  </span>
                  {m.medication_name}
                  {m.dose ? ` — ${m.dose}` : ''}
                </li>
              ))}
            </ul>
          )}
          <p className="muted" style={{ fontSize: '0.78rem' }}>
            Recorded patient history — not a treatment recommendation.
          </p>
          <Link to="/timeline" className="row" style={{ fontSize: '0.82rem', gap: '0.3rem' }}>
            View full event-sourced timeline <ArrowRight size={14} />
          </Link>
        </>
      )}

      {hba1c && (
        <>
          <h3>HbA1c</h3>
          {hba1c.trend === 'no_data' ? (
            <p className="muted">No HbA1c measurements are on record for this patient.</p>
          ) : (
            <>
              {hba1c.trend === 'insufficient_data' && (
                <p className="muted">
                  Only {hba1c.history.length} measurement{hba1c.history.length === 1 ? '' : 's'} on
                  record — not enough to describe a trend.
                </p>
              )}
              {hba1cChartData.length > 1 && (
                <div className="table-scroll" style={{ width: '100%', height: 200 }}>
                  <ResponsiveContainer minWidth={280}>
                    <LineChart data={hba1cChartData} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="date" fontSize={12} stroke="var(--muted)" />
                      <YAxis fontSize={12} domain={['auto', 'auto']} stroke="var(--muted)" />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--surface-solid)',
                          border: '1px solid var(--border)',
                          borderRadius: 10,
                          fontSize: '0.82rem',
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        name="HbA1c (%)"
                        stroke="var(--brand)"
                        strokeWidth={2.5}
                        dot={{ r: 3.5, fill: 'var(--brand)', strokeWidth: 0 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hba1c.history.map((h, i) => (
                      <tr key={i}>
                        <td>{new Date(h.recorded_at).toLocaleDateString()}</td>
                        <td>
                          {h.value}
                          {h.unit ?? '%'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: '0.78rem' }}>
                Trend across available measurements: <strong>{hba1c.trend}</strong>. Trend
                classification is not a diagnostic threshold.
              </p>
            </>
          )}
        </>
      )}
    </>
  )
}
