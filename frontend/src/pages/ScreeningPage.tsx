import { BarChart3, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api/client'
import type { ModelComparison, Screening } from '../api/types'
import { usePatients } from '../PatientContext'
import { AgentTrace, ErrorNote, RiskBadge } from '../components/common'
import { SafetyStatus } from '../components/clinical/SafetyStatus'
import { MetricCluster } from '../components/common/MetricCluster'
import { ScopeDisclaimer } from '../components/SafetyBanner'

const COMPARISON_METRICS: [string, string][] = [
  ['accuracy', 'Accuracy'],
  ['precision', 'Precision'],
  ['recall', 'Recall'],
  ['f1', 'F1'],
  ['roc_auc', 'ROC-AUC'],
]

export function ScreeningPage() {
  const { selected } = usePatients()
  const [result, setResult] = useState<Screening | null>(null)
  const [comparison, setComparison] = useState<ModelComparison | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Supplementary context (how reliable is the production model overall)
    // — a failure here must not block running or viewing a screening.
    api.mlComparison().then(setComparison).catch(() => setComparison(null))
  }, [])

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

  const metricItems = comparison
    ? COMPARISON_METRICS.map(([key, label]) => ({
        label,
        value: comparison.metrics_table[key]?.random_forest?.toFixed(4) ?? '—',
      }))
    : []

  return (
    <>
      <div className="section-block">
        <span className="eyebrow">
          <Sparkles /> Production risk model
        </span>
        <h1 className="section-title">Diabetes Risk Screening</h1>
        <p className="section-lead">
          Patient #{selected.id} — {selected.pseudonym}. Production RandomForest model
          evaluation.
        </p>
      </div>
      {/* Permanent, not conditional: this disclaimer must be visible whether or
          not a result has been produced. */}
      <ScopeDisclaimer text={result?.disclaimer} />
      <ErrorNote error={error} />

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <button onClick={run} disabled={busy}>
          {busy ? 'Running…' : 'Run screening baseline'}
        </button>
      </div>

      {result && (
        <>
          <SafetyStatus safety={result.safety} />

          {result.status === 'unavailable_for_profile' ? (
            <div className="section-block">
              <h2 className="section-title" style={{ fontSize: '1.2rem' }}>
                Screening model unavailable for this profile
              </h2>
              <p>{result.unavailable_reason}</p>
              <p className="muted">
                This is a deliberate design decision rather than a failure. Forcing a prediction
                with a missing or substituted value would return a confident-looking number with
                no real basis — so the agent refuses instead of guessing.
              </p>
            </div>
          ) : (
            <>
              <div className="section-block">
                <span className="micro-label">Model output</span>
                <div className="stat-hero">
                  <div>
                    <div className="stat-hero-value">{((result.risk_probability ?? 0) * 100).toFixed(0)}%</div>
                    <span className="stat-hero-label">Model score</span>
                  </div>
                  <div className="stat-hero-meta">
                    <RiskBadge tier={result.risk_tier} />
                    <span className="muted" style={{ fontSize: '0.78rem' }}>
                      Production · RandomForest · <code>{result.model_version}</code>
                    </span>
                  </div>
                </div>
                <p>{result.summary_text}</p>
              </div>

              {comparison && (
                <div className="section-block">
                  <span className="micro-label">Model evaluation metrics</span>
                  <MetricCluster items={metricItems} />
                  <p className="muted" style={{ fontSize: '0.78rem', marginTop: 'var(--space-2)' }}>
                    From a fixed historical test set of {comparison.n_test.toLocaleString()} records
                    — not a statement about this specific patient.
                  </p>
                </div>
              )}

              {featureData.length > 0 && (
                <div className="section-block">
                  <span className="micro-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <BarChart3 size={13} /> Why the model predicted this
                  </span>
                  <div style={{ width: '100%', height: 240 }}>
                    <ResponsiveContainer>
                      <BarChart
                        data={featureData}
                        layout="vertical"
                        margin={{ top: 4, right: 24, bottom: 4, left: 60 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis type="number" fontSize={12} stroke="var(--muted)" />
                        <YAxis type="category" dataKey="name" fontSize={12} width={140} stroke="var(--muted)" />
                        <Tooltip
                          contentStyle={{
                            background: 'var(--surface-solid)',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            fontSize: '0.82rem',
                          }}
                        />
                        <Bar dataKey="value" fill="var(--brand)" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="muted">
                    These are the trained model's global feature importances, not a
                    patient-specific attribution.
                  </p>
                </div>
              )}
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
