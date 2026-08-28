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
import { AgentTrace, Card, ErrorNote, RiskBadge } from '../components/common'
import { SafetyBanner, ScopeDisclaimer } from '../components/SafetyBanner'

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

  return (
    <>
      <h1>What-if Simulator</h1>
      <p className="muted">
        Forks a copy of the digital twin, applies a transparent delta model, and re-scores each
        projected week. The real timeline is never modified.
      </p>
      <ScopeDisclaimer />
      <ErrorNote error={error} />

      <Card title="Describe a scenario in your own words">
        <p className="muted" style={{ marginTop: 0 }}>
          A small deterministic parser — not an LLM — maps phrases like these to a structured
          change. If it can't confidently understand your text, it says so rather than guessing;
          try a preset or the custom fields below instead.
        </p>
        <div className="row">
          <input
            style={{ flex: 1, minWidth: 280 }}
            value={scenarioText}
            placeholder="e.g. what if I lost weight and exercised more"
            onChange={(e) => setScenarioText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) runText(scenarioText)
            }}
          />
          <button onClick={() => runText(scenarioText)} disabled={busy || !scenarioText.trim()}>
            {busy ? 'Parsing…' : 'Parse & run'}
          </button>
        </div>
        <div className="row" style={{ marginTop: '0.6rem' }}>
          {TEXT_EXAMPLES.map((ex) => (
            <button
              key={ex}
              className="secondary"
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
      </Card>

      <Card title="Preset scenarios">
        <div className="row">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className="secondary"
              disabled={busy}
              onClick={() => runWith(p.hypothesis)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Custom hypothesis">
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
        <div style={{ marginTop: '0.9rem' }}>
          <button onClick={runForm} disabled={busy}>
            {busy ? 'Projecting…' : 'Run simulation'}
          </button>
        </div>
      </Card>

      {result && (
        <>
          <SafetyBanner safety={result.safety} />

          {result.status === 'unavailable_for_profile' ? (
            <Card title="Simulation not run">
              <p>{result.unavailable_reason}</p>
            </Card>
          ) : (
            <>
              <Card title="Projected risk trajectory">
                <p className="muted" style={{ marginTop: 0 }}>
                  <strong>{result.label}.</strong> This shows how the trained model responds to
                  changed inputs — not a forecast of real clinical outcomes.
                </p>
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <LineChart
                      data={result.trajectory}
                      margin={{ top: 8, right: 74, bottom: 8, left: -8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e6ebf2" />
                      <XAxis
                        dataKey="week"
                        fontSize={12}
                        label={{ value: 'week', position: 'insideBottom', offset: -4, fontSize: 12 }}
                      />
                      <YAxis
                        fontSize={12}
                        domain={[0, 1]}
                        tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                      />
                      <Tooltip
                        formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
                        labelFormatter={(l) => `Week ${l}`}
                      />
                      {baseline !== undefined && (
                        <ReferenceLine
                          y={baseline}
                          stroke="#8896a8"
                          strokeDasharray="4 4"
                          label={{
                            value: 'baseline',
                            fontSize: 11,
                            position: 'right',
                            fill: '#5c6a7f',
                          }}
                        />
                      )}
                      <ReferenceLine y={0.33} stroke="#8dc7aa" strokeDasharray="2 4" />
                      <ReferenceLine y={0.66} stroke="#e0ab4a" strokeDasharray="2 4" />
                      <Line
                        type="monotone"
                        dataKey="risk_probability"
                        name="Projected risk"
                        stroke="#1d6fa5"
                        strokeWidth={2.5}
                        dot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p>{result.summary_text}</p>
              </Card>

              <Card title="Projected points">
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
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </Card>

              <Card title="Delta model assumptions">
                <p className="muted" style={{ marginTop: 0 }}>
                  The projection is a documented heuristic, not a validated physiological model.
                  Every assumption it applied is listed here.
                </p>
                <ul style={{ fontSize: '0.86rem' }}>
                  {result.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </Card>
            </>
          )}

          <Card title="Agent trace">
            <AgentTrace trace={result.trace} />
          </Card>
        </>
      )}
    </>
  )
}
