import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api/client'
import type {
  ClinicalAnalysis,
  ClinicalClaim,
  DigitalTwin,
  EvidenceSource,
  LabTrend,
  ModelComparison,
} from '../api/types'
import { usePatients } from '../PatientContext'
import { AgentTrace, Card, ErrorNote, RiskBadge } from '../components/common'
import { EvidenceCitations } from '../components/EvidenceCitation'
import { SafetyBanner, ScopeDisclaimer } from '../components/SafetyBanner'

const QUESTION_MAX_LENGTH = 2000

const CLAIM_TYPE_LABEL: Record<string, string> = {
  patient_observation: 'patient data',
  model_observation: 'model output',
  evidence_supported: 'evidence-backed',
  inference: 'bounded synthesis',
  uncertainty: 'uncertainty',
}

const ANALYSIS_OPTIONS = [
  {
    key: 'includeEvidence' as const,
    label: 'Medical evidence',
    description: 'Retrieve relevant local medical evidence.',
  },
  {
    key: 'includePubmed' as const,
    label: 'PubMed literature',
    description: 'Include PubMed literature when available.',
  },
  {
    key: 'includeModelComparison' as const,
    label: 'Compare models',
    description: 'Show the candidate XGBoost model alongside the production model.',
  },
  {
    key: 'includeSimulation' as const,
    label: 'What-if simulation',
    description: 'Run an available model-based scenario.',
  },
]

// Cosmetic only — the backend's raw snake_case field name, reformatted for
// display. Never reinterprets or relabels what the value means (e.g. never
// turns a 0/1 into "Yes"/"No"), since that would be a frontend judgment
// about clinical meaning, not a formatting change.
function humanizeFieldName(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

function EvidenceRefs({ ids }: { ids: string[] }) {
  if (!ids.length) return null
  return (
    <>
      {' '}
      {ids.map((id) => (
        <a key={id} href={`#${id}`} className="evidence-chip">
          {id}
        </a>
      ))}
    </>
  )
}

function ClaimList({ claims }: { claims: ClinicalClaim[] }) {
  if (!claims?.length) return <p className="muted">None for this analysis.</p>
  return (
    <ul style={{ fontSize: '0.88rem', paddingLeft: '1.1rem' }}>
      {claims.map((c, i) => (
        <li key={i} style={{ marginBottom: '0.45rem' }}>
          {c.claim}
          <EvidenceRefs ids={c.evidence_ids} />{' '}
          <span className="badge neutral" style={{ fontSize: '0.68rem', verticalAlign: 'middle' }}>
            {CLAIM_TYPE_LABEL[c.claim_type] ?? c.claim_type}
          </span>
        </li>
      ))}
    </ul>
  )
}

const COMPARISON_METRICS: [string, string][] = [
  ['accuracy', 'Accuracy'],
  ['precision', 'Precision'],
  ['recall', 'Recall'],
  ['f1', 'F1'],
  ['roc_auc', 'ROC-AUC'],
]

function ModelComparisonTable({ comparison }: { comparison: ModelComparison }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>RandomForest (production)</th>
            <th>XGBoost (candidate)</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON_METRICS.map(([key, label]) => {
            const row = comparison.metrics_table[key]
            if (!row) return null
            return (
              <tr key={key}>
                <td>{label}</td>
                <td>{row.random_forest?.toFixed(4) ?? '—'}</td>
                <td>{row.xgboost?.toFixed(4) ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: '0.76rem', marginTop: '0.5rem', marginBottom: 0 }}>
        From a fixed historical test set of {comparison.n_test.toLocaleString()} records — not a
        statement about this specific patient. Values are supplied by the backend, never
        recomputed in the browser.
      </p>
    </div>
  )
}

export function ClinicalAnalysisPage() {
  const { selected } = usePatients()

  const [question, setQuestion] = useState('')
  const [includeEvidence, setIncludeEvidence] = useState(true)
  const [includePubmed, setIncludePubmed] = useState(false)
  const [includeModelComparison, setIncludeModelComparison] = useState(false)
  const [includeSimulation, setIncludeSimulation] = useState(false)

  const [result, setResult] = useState<ClinicalAnalysis | null>(null)
  const [comparison, setComparison] = useState<ModelComparison | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestInFlight = useRef(false)

  // Digital Twin view — reuses the existing Phase 2 endpoints directly
  // rather than re-deriving this from the analysis result, which only
  // carries a filtered, question-relevant subset as prose.
  const [twin, setTwin] = useState<DigitalTwin | null>(null)
  const [hba1c, setHba1c] = useState<LabTrend | null>(null)

  const loadTwinView = useCallback(async (patientId: number) => {
    try {
      const [twinResult, hba1cResult] = await Promise.all([
        api.digitalTwin(patientId),
        api.labTrend(patientId, 'HbA1c'),
      ])
      setTwin(twinResult)
      setHba1c(hba1cResult)
    } catch {
      // Non-fatal: the twin/lab view is supplementary context, not the
      // analysis itself — a failure here must not block the page.
      setTwin(null)
      setHba1c(null)
    }
  }, [])

  useEffect(() => {
    if (selected) void loadTwinView(selected.id)
  }, [selected, loadTwinView])

  const optionValues: Record<(typeof ANALYSIS_OPTIONS)[number]['key'], boolean> = {
    includeEvidence,
    includePubmed,
    includeModelComparison,
    includeSimulation,
  }
  const optionSetters: Record<(typeof ANALYSIS_OPTIONS)[number]['key'], (v: boolean) => void> = {
    includeEvidence: setIncludeEvidence,
    includePubmed: setIncludePubmed,
    includeModelComparison: setIncludeModelComparison,
    includeSimulation: setIncludeSimulation,
  }

  const analyze = async () => {
    // Belt-and-suspenders beyond the disabled button — a ref check (not
    // state, which wouldn't be visible synchronously within this same
    // handler) so a second overlapping call can never start.
    if (!selected || !question.trim() || requestInFlight.current) return
    requestInFlight.current = true
    setBusy(true)
    setError(null)
    setComparison(null)
    try {
      const [analysisResult] = await Promise.all([
        api.analyzeClinical(selected.id, question.trim(), {
          includeEvidence,
          includePubmed,
          includeModelComparison,
          includeSimulation,
        }),
        includeModelComparison
          ? api.mlComparison().then(setComparison).catch(() => setComparison(null))
          : Promise.resolve(),
      ])
      setResult(analysisResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      requestInFlight.current = false
    }
  }

  if (!selected) return <p className="muted">Select a patient on the Intake page first.</p>

  const blocked = result?.safety.status === 'BLOCKED'

  const rfClaim = result?.model_analysis.find((c) => c.claim.includes('production RandomForest') && c.claim.includes('assigned a score'))
  const xgbClaim = result?.model_analysis.find((c) => c.claim.includes('XGBoost candidate model') && c.claim.includes('assigned a score'))
  const contributionClaims = result?.model_analysis.filter((c) => c.claim.includes('MODEL FEATURE CONTRIBUTIONS') || c.claim.includes('Top model feature contributions')) ?? []
  const conflictClaim = result?.model_analysis.find((c) => c.claim_type === 'uncertainty' && c.claim.includes('different risk tiers'))
  const comparisonClaim = result?.model_analysis.find((c) => c.claim.includes('Model evaluation metrics'))

  const hba1cChartData = (hba1c?.history ?? []).map((h) => ({
    date: new Date(h.recorded_at).toLocaleDateString(),
    value: h.value,
  }))

  // Evidence findings, indexed by their true [E#] position (the order the
  // backend actually retrieved and cited them in), then split for display
  // only — Local vs PubMed — without renumbering anything (Step 20).
  const indexedEvidence: { source: EvidenceSource; index: number }[] =
    result?.evidence_findings.map((source, i) => ({ source, index: i + 1 })) ?? []
  const localEvidence = indexedEvidence.filter((e) => e.source.source_type !== 'pubmed')
  const pubmedEvidence = indexedEvidence.filter((e) => e.source.source_type === 'pubmed')

  const questionRemaining = QUESTION_MAX_LENGTH - question.length

  return (
    <>
      <h1>Clinical Analysis</h1>
      <p className="muted">
        Evidence-grounded analysis of the selected patient profile — composes the Digital Twin,
        the production and candidate risk models, retrieved evidence, and (optionally) a what-if
        simulation into one structured, cited analysis, reviewed by the Safety Agent before being
        shown here.
      </p>
      <ScopeDisclaimer />
      <ErrorNote error={error} />

      <Card title="Ask a clinical question">
        <p className="muted" style={{ marginTop: 0 }}>
          Patient #{selected.id} — {selected.pseudonym}
        </p>
        <label htmlFor="clinical-question" style={{ display: 'block', marginBottom: '0.3rem' }}>
          Clinical question
        </label>
        <textarea
          id="clinical-question"
          rows={2}
          style={{ width: '100%' }}
          value={question}
          maxLength={QUESTION_MAX_LENGTH}
          placeholder="e.g. What factors are relevant to this patient's diabetes risk, especially blood pressure and BMI?"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !busy && question.trim()) {
              e.preventDefault()
              void analyze()
            }
          }}
        />
        <div className="row" style={{ justifyContent: 'space-between', marginTop: '0.15rem' }}>
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            Ctrl/Cmd+Enter to analyze
          </span>
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            {questionRemaining} characters remaining
          </span>
        </div>

        <div className="grid-2" style={{ marginTop: '0.7rem' }}>
          {ANALYSIS_OPTIONS.map((opt) => (
            <label key={opt.key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={optionValues[opt.key]}
                onChange={(e) => optionSetters[opt.key](e.target.checked)}
                style={{ marginTop: '0.2rem' }}
              />
              <span>
                <span style={{ display: 'block', color: 'var(--text)', fontWeight: 500 }}>{opt.label}</span>
                <span style={{ display: 'block', fontSize: '0.78rem' }}>{opt.description}</span>
              </span>
            </label>
          ))}
        </div>

        <div style={{ marginTop: '0.9rem' }}>
          <button onClick={() => void analyze()} disabled={busy || !question.trim()}>
            {busy ? 'Analyzing…' : 'Analyze Patient'}
          </button>
        </div>

        {busy && (
          <div className="muted" style={{ marginTop: '0.7rem', fontSize: '0.82rem' }}>
            This analysis includes:
            <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.2rem' }}>
              <li>Risk scoring (production RandomForest model)</li>
              {includeModelComparison && <li>Model comparison (XGBoost candidate model)</li>}
              {includeEvidence && <li>Local evidence retrieval</li>}
              {includePubmed && <li>PubMed literature retrieval</li>}
              {includeSimulation && <li>What-if simulation</li>}
              <li>Safety review</li>
            </ul>
          </div>
        )}
      </Card>

      <Card title="Digital Twin">
        {!twin ? (
          <p className="muted">Digital Twin view unavailable for this patient right now.</p>
        ) : (
          <>
            <h3 style={{ marginTop: 0 }}>Health & lifestyle</h3>
            <dl className="kv" style={{ fontSize: '0.86rem' }}>
              {Object.entries({ ...twin.clinical, ...twin.lifestyle }).map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{humanizeFieldName(k)}</dt>
                  <dd>{String(v)}</dd>
                </div>
              ))}
            </dl>
            <h3 style={{ marginTop: '1rem' }}>Current medications</h3>
            {twin.medications.current.length === 0 ? (
              <p className="muted">No current medications on record.</p>
            ) : (
              <ul style={{ fontSize: '0.86rem' }}>
                {twin.medications.current.map((m, i) => (
                  <li key={i}>
                    {m.medication_name}
                    {m.dose ? ` — ${m.dose}` : ''}{' '}
                    <span className="muted">(recorded {new Date(m.recorded_at).toLocaleDateString()})</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted" style={{ fontSize: '0.78rem' }}>
              Recorded patient history — not a treatment recommendation.
            </p>
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
                        <CartesianGrid strokeDasharray="3 3" stroke="#e6ebf2" />
                        <XAxis dataKey="date" fontSize={12} />
                        <YAxis fontSize={12} domain={['auto', 'auto']} />
                        <Tooltip />
                        <Line type="monotone" dataKey="value" name="HbA1c (%)" stroke="#1d6fa5" strokeWidth={2} dot={{ r: 3 }} />
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
      </Card>

      {result && (
        <>
          <SafetyBanner safety={result.safety} />

          {blocked && (
            <Card title="Analysis withheld">
              <p className="muted">
                The Safety Agent blocked this analysis. Nothing below reflects the withheld content —
                only what the safety layer approved for display.
              </p>
            </Card>
          )}

          <Card title="Patient observations">
            <ClaimList claims={result.patient_summary} />
          </Card>

          <Card title="Model analysis">
            <div className="grid-2">
              <div>
                <h3>Production model — RandomForest</h3>
                {rfClaim ? <p>{rfClaim.claim}</p> : <p className="muted">Not available for this profile.</p>}
                {result.production_risk_tier && <RiskBadge tier={result.production_risk_tier} />}
              </div>
              <div>
                <h3>Candidate model — XGBoost</h3>
                {includeModelComparison ? (
                  xgbClaim ? <p>{xgbClaim.claim}</p> : <p className="muted">Not available for this profile.</p>
                ) : (
                  <p className="muted">Not requested for this analysis.</p>
                )}
              </div>
            </div>
            {conflictClaim && (
              <div className="banner flagged" style={{ marginTop: '0.6rem' }}>
                {conflictClaim.claim}
              </div>
            )}
            {comparison ? (
              <>
                <h3 style={{ marginTop: '0.8rem' }}>Model evaluation metrics</h3>
                <ModelComparisonTable comparison={comparison} />
              </>
            ) : (
              includeModelComparison &&
              comparisonClaim && (
                <p className="muted" style={{ marginTop: '0.8rem', fontSize: '0.82rem' }}>
                  {comparisonClaim.claim}
                </p>
              )
            )}
          </Card>

          {contributionClaims.length > 0 && (
            <Card title="Model Feature Contributions">
              <p className="muted" style={{ marginTop: 0, fontSize: '0.82rem' }}>
                These values describe how the model uses features; they do not establish
                causation.
              </p>
              <ClaimList claims={contributionClaims} />
            </Card>
          )}

          <Card title="Evidence">
            {!includeEvidence && !includePubmed ? (
              <p className="muted">Evidence retrieval was not requested for this analysis.</p>
            ) : indexedEvidence.length === 0 ? (
              <p className="muted">No sufficiently relevant evidence was retrieved for this query.</p>
            ) : (
              <>
                {localEvidence.length > 0 && (
                  <>
                    <h3 style={{ marginTop: 0 }}>Local evidence</h3>
                    <EvidenceCitations items={localEvidence} />
                  </>
                )}
                {includePubmed && (
                  <>
                    <h3>PubMed evidence</h3>
                    {pubmedEvidence.length > 0 ? (
                      <EvidenceCitations items={pubmedEvidence} />
                    ) : (
                      <p className="muted" style={{ fontSize: '0.82rem' }}>
                        Either no relevant PubMed result was available, or PubMed was unavailable for
                        this request. Local evidence above is unaffected.
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </Card>

          <Card title="Integrated analysis">
            <ClaimList claims={result.integrated_analysis} />
            {result.safety_flags.length > 0 && (
              <p className="muted" style={{ fontSize: '0.78rem' }}>
                Generation flags: {result.safety_flags.join(' ')}
              </p>
            )}
          </Card>

          {includeSimulation && (
            <Card title="Model Simulation">
              {!result.simulation ? (
                <p className="muted">Simulation unavailable for this profile/request.</p>
              ) : result.simulation.status === 'unavailable_for_profile' ? (
                <p className="muted">Simulation unavailable for this profile/request. {result.simulation.unavailable_reason}</p>
              ) : (
                <>
                  <p className="muted" style={{ marginTop: 0 }}>
                    {result.simulation.label}. Not a predicted clinical outcome, not a guaranteed
                    result.
                  </p>
                  <p>{result.simulation.summary_text}</p>
                </>
              )}
            </Card>
          )}

          <Card title="Uncertainty & limitations">
            {result.uncertainties.length === 0 ? (
              <p className="muted">No uncertainty notes were returned for this analysis.</p>
            ) : (
              <ul style={{ fontSize: '0.86rem' }}>
                {result.uncertainties.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            )}
          </Card>

          <details className="card">
            <summary>Analysis details (trace)</summary>
            <div className="details-body">
              <AgentTrace trace={result.trace} />
            </div>
          </details>
        </>
      )}
    </>
  )
}
