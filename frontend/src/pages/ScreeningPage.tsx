import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api/client'
import type { Screening } from '../api/types'
import { usePatients } from '../PatientContext'
import { AgentTrace, Card, ErrorNote, RiskBadge } from '../components/common'
import { SafetyBanner, ScopeDisclaimer } from '../components/SafetyBanner'

export function ScreeningPage() {
  const { selected } = usePatients()
  const [result, setResult] = useState<Screening | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      setResult(await api.runScreening(selected.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!selected) return <p className="muted">Select a patient on the Intake page first.</p>

  const featureData = Object.entries(result?.top_features ?? {}).map(([name, value]) => ({
    name,
    value: Number(value.toFixed(4)),
  }))

  return (
    <>
      <h1>Screening Dashboard</h1>
      <p className="muted">
        Patient #{selected.id} — {selected.pseudonym}
      </p>
      {/* Permanent, not conditional: this disclaimer must be visible whether or
          not a result has been produced. */}
      <ScopeDisclaimer text={result?.disclaimer} />
      <ErrorNote error={error} />

      <Card>
        <button onClick={run} disabled={busy}>
          {busy ? 'Running…' : 'Run screening baseline'}
        </button>
      </Card>

      {result && (
        <>
          <SafetyBanner safety={result.safety} />

          {result.status === 'unavailable_for_profile' ? (
            <Card title="Screening model unavailable for this profile">
              <p>{result.unavailable_reason}</p>
              <p className="muted">
                This is a deliberate design decision rather than a failure. Forcing a prediction
                with a missing or substituted value would return a confident-looking number with
                no real basis — so the agent refuses instead of guessing.
              </p>
            </Card>
          ) : (
            <>
              <Card title="Result">
                <div className="row" style={{ gap: '2rem', alignItems: 'baseline' }}>
                  <div>
                    <div className="muted">Model probability</div>
                    <div style={{ fontSize: '2rem', fontWeight: 700 }}>
                      {((result.risk_probability ?? 0) * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div>
                    <div className="muted">Risk tier</div>
                    <div style={{ fontSize: '1.3rem' }}>
                      <RiskBadge tier={result.risk_tier} />
                    </div>
                  </div>
                  <div>
                    <div className="muted">Model version</div>
                    <div>
                      <code>{result.model_version}</code>
                    </div>
                  </div>
                </div>
                <p style={{ marginTop: '0.9rem' }}>{result.summary_text}</p>
              </Card>

              {featureData.length > 0 && (
                <Card title="Top contributing features (global model importance)">
                  <div style={{ width: '100%', height: 240 }}>
                    <ResponsiveContainer>
                      <BarChart
                        data={featureData}
                        layout="vertical"
                        margin={{ top: 4, right: 24, bottom: 4, left: 60 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e6ebf2" />
                        <XAxis type="number" fontSize={12} />
                        <YAxis type="category" dataKey="name" fontSize={12} width={140} />
                        <Tooltip />
                        <Bar dataKey="value" fill="#1d6fa5" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="muted">
                    These are the trained model's global feature importances, not a
                    patient-specific attribution.
                  </p>
                </Card>
              )}
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
