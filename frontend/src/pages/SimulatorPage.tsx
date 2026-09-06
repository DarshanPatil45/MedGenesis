import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api/client'
import type { Simulation } from '../api/types'
import { usePatients } from '../PatientContext'
import { AgentTrace, ErrorNote, RiskBadge } from '../components/common'
import { SafetyStatus } from '../components/clinical/SafetyStatus'
import { ScopeDisclaimer } from '../components/SafetyBanner'

const PRESETS: { label: string; hypothesis: Record<string, number> }[] = [
  { label: 'Lose 5 kg over 12 weeks', hypothesis: { weight_kg_delta: -5, horizon_weeks: 12 } },
  {
    label: 'Lose 8 kg + become active, 16 weeks',
    hypothesis: { weight_kg_delta: -8, activity_minutes_delta: 60, horizon_weeks: 16 },
  },
  { label: 'BMI −3 over 12 weeks', hypothesis: { bmi_delta: -3, horizon_weeks: 12 } },
  { label: 'Quit smoking over 12 weeks', hypothesis: { smoker_delta: -1, horizon_weeks: 12 } },
]

const TEXT_EXAMPLES = [
  'what if I lost weight and exercised more',
  'what if I quit smoking over 8 weeks',
  'what if I lost 10 lbs and started exercising',
]

export function SimulatorPage() {
  const { selected } = usePatients()
  const [form, setForm] = useState({
    bmi_delta: '',
    weight_kg_delta: '-5',
    activity_minutes_delta: '0',
    smoker_delta: '0',
    horizon_weeks: '12',
  })
  const [scenarioText, setScenarioText] = useState('')
  const [result, setResult] = useState<Simulation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runWith = async (hypothesis: Record<string, number>, text?: string) => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      setResult(await api.simulate(selected.id, hypothesis, text))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const runForm = () => {
    const hypothesis: Record<string, number> = {}
    for (const [key, value] of Object.entries(form)) {
      if (value !== '') hypothesis[key] = Number(value)
    }
    void runWith(hypothesis)
  }

  const runText = (text: string) => {
    if (!text.trim()) return
    void runWith({}, text)
  }

  if (!selected) return <p className="muted">Select a patient on the Intake page first.</p>

  const baseline = result?.trajectory[0]?.risk_probability
  const final = result?.trajectory[result.trajectory.length - 1]

  return (
    <>
      <div className="section-block">
        <span className="eyebrow">
          <Sparkles /> Transparent delta model
        </span>
        <h1 className="section-title">What-if Lab</h1>
        <p className="section-lead">
          Explore modeled scenarios without touching the patient's Digital Twin. Forks a copy,
          applies a transparent delta model, and re-scores each projected week — the real
          timeline is never modified.
        </p>
      </div>
      <ScopeDisclaimer />
      <ErrorNote error={error} />

      <div className="command-bar" style={{ marginBottom: 'var(--space-5)' }}>
        <label htmlFor="scenario-text" style={{ display: 'block', marginBottom: '0.4rem' }}>
          Describe a scenario in your own words
        </label>
        <div className="row">
          <input
            id="scenario-text"
            style={{ flex: 1, minWidth: 240 }}
            value={scenarioText}
            placeholder="e.g. what if I lost weight and exercised more"
            onChange={(e) => setScenarioText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) runText(scenarioText)
            }}
          />
          <button onClick={() => runText(scenarioText)} disabled={busy || !scenarioText.trim()}>
            {busy ? 'Parsing…' : 'Run scenario →'}
          </button>
        </div>
        <p className="muted" style={{ fontSize: '0.78rem' }}>
          A small deterministic parser — not an LLM — maps phrases like these to a structured
          change. If it can't confidently understand your text, it says so rather than guessing.
        </p>
        <div className="chip-row">
          {TEXT_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => {
                setScenarioText(ex)
                runText(ex)
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div className="section-block">
        <span className="micro-label">Preset scenarios</span>
        <div className="chip-row">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className="chip" disabled={busy} onClick={() => runWith(p.hypothesis)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="section-block">
        <span className="micro-label">Custom hypothesis</span>
        <div className="grid-2">
          <label>
            Weight change (kg)
            <input
              type="number"
              step="any"
              value={form.weight_kg_delta}
              onChange={(e) => setForm({ ...form, weight_kg_delta: e.target.value })}
            />
          </label>
          <label>
            BMI change
            <input
              type="number"
              step="any"
              value={form.bmi_delta}
              onChange={(e) => setForm({ ...form, bmi_delta: e.target.value })}
            />
          </label>
          <label>
            Physical activity
            <select
              value={form.activity_minutes_delta}
              onChange={(e) => setForm({ ...form, activity_minutes_delta: e.target.value })}
            >
              <option value="0">No change</option>
              <option value="60">Become physically active</option>
              <option value="-60">Become physically inactive</option>
            </select>
          </label>
          <label>
            Smoking
            <select
              value={form.smoker_delta}
              onChange={(e) => setForm({ ...form, smoker_delta: e.target.value })}
            >
              <option value="0">No change</option>
              <option value="-1">Quit smoking</option>
              <option value="1">Start smoking</option>
            </select>
          </label>
          <label>
            Horizon (weeks)
            <input
              type="number"
              min={4}
              max={52}
              value={form.horizon_weeks}
              onChange={(e) => setForm({ ...form, horizon_weeks: e.target.value })}
            />
          </label>
        </div>
        <div style={{ marginTop: '1rem' }}>
          <button onClick={runForm} disabled={busy}>
            {busy ? 'Projecting…' : 'Run scenario →'}
          </button>
        </div>
      </div>

      {result && (
        <>
          <SafetyStatus safety={result.safety} />

          {result.status === 'unavailable_for_profile' ? (
            <div className="section-block">
              <h2 className="section-title" style={{ fontSize: '1.2rem' }}>
                Simulation not run
              </h2>
              <p>{result.unavailable_reason}</p>
            </div>
          ) : (
            <>
              <div className="section-block">
                <span className="micro-label">Baseline vs scenario</span>
                <p className="muted" style={{ marginTop: 0 }}>
                  <strong>{result.label}.</strong> This shows how the trained model responds to
                  changed inputs — not a forecast of real clinical outcomes.
                </p>
                {result.trajectory.length > 1 && final && (
                  <div className="metric-cluster" style={{ marginBottom: 'var(--space-4)' }}>
                    <div className="metric-cluster-item">
                      <span className="metric-cluster-label">Baseline · week {result.trajectory[0].week}</span>
                      <span className="metric-cluster-value">{(baseline! * 100).toFixed(0)}%</span>
                    </div>
                    <div className="metric-cluster-item">
                      <span className="metric-cluster-label">Simulated · week {final.week}</span>
                      <span className="metric-cluster-value">{(final.risk_probability * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                )}
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <LineChart
                      data={result.trajectory}
                      margin={{ top: 8, right: 74, bottom: 8, left: -8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="week"
                        fontSize={12}
                        stroke="var(--muted)"
                        label={{ value: 'week', position: 'insideBottom', offset: -4, fontSize: 12, fill: 'var(--muted)' }}
                      />
                      <YAxis
                        fontSize={12}
                        stroke="var(--muted)"
                        domain={[0, 1]}
                        tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                      />
                      <Tooltip
                        formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
                        labelFormatter={(l) => `Week ${l}`}
                        contentStyle={{
                          background: 'var(--surface-solid)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          fontSize: '0.82rem',
                        }}
                      />
                      {baseline !== undefined && (
                        <ReferenceLine
                          y={baseline}
                          stroke="var(--muted)"
                          strokeDasharray="4 4"
                          label={{
                            value: 'baseline',
                            fontSize: 11,
                            position: 'right',
                            fill: 'var(--muted)',
                          }}
                        />
                      )}
                      <ReferenceLine y={0.33} stroke="var(--ok-border)" strokeDasharray="2 4" />
                      <ReferenceLine y={0.66} stroke="var(--flag-border)" strokeDasharray="2 4" />
                      <Line
                        type="monotone"
                        dataKey="risk_probability"
                        name="Simulated risk"
                        stroke="var(--brand)"
                        strokeWidth={2.5}
                        dot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p>{result.summary_text}</p>
              </div>

              <div className="section-block">
                <span className="micro-label">Projected points</span>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th>Risk</th>
                        <th>Tier</th>
                        <th>BMI</th>
                        <th>Physical activity</th>
                        <th>Smoker</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {result.trajectory.map((p) => (
                        <tr key={p.week}>
                          <td>{p.week}</td>
                          <td>{(p.risk_probability * 100).toFixed(1)}%</td>
                          <td>
                            <RiskBadge tier={p.risk_tier} />
                          </td>
                          <td>{p.bmi ?? '—'}</td>
                          <td>{p.phys_activity != null ? `${(p.phys_activity * 100).toFixed(0)}%` : '—'}</td>
                          <td>{p.smoker != null ? `${(p.smoker * 100).toFixed(0)}%` : '—'}</td>
                          <td>{p.simulated && <span className="badge neutral">simulated</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="section-block">
                <span className="micro-label">Delta model assumptions</span>
                <p className="muted" style={{ marginTop: 0 }}>
                  The projection is a documented heuristic, not a validated physiological model.
                  Every assumption it applied is listed here.
                </p>
                <ul style={{ fontSize: '0.86rem' }}>
                  {result.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            </>
          )}

          <details className="card">
            <summary className="row" style={{ gap: '0.5rem' }}>
              Agent trace
            </summary>
            <div className="details-body">
              <AgentTrace trace={result.trace} />
            </div>
          </details>
        </>
      )}
    </>
  )
}
