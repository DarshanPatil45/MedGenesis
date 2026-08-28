import { useCallback, useEffect, useState } from 'react'
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
import type { ClinicalAnalysis, ClinicalClaim, DigitalTwin, LabTrend } from '../api/types'
import { usePatients } from '../PatientContext'
import { AgentTrace, Card, ErrorNote, RiskBadge } from '../components/common'
import { EvidenceCitations } from '../components/EvidenceCitation'
import { SafetyBanner, ScopeDisclaimer } from '../components/SafetyBanner'

const CLAIM_TYPE_LABEL: Record<string, string> = {
  patient_observation: 'patient data',
  model_observation: 'model output',
  evidence_supported: 'evidence-backed',
  inference: 'bounded synthesis',
  uncertainty: 'uncertainty',
}

function ClaimList({ claims }: { claims: ClinicalClaim[] }) {
  if (!claims?.length) return <p className="muted">None for this analysis.</p>
  return (
    <ul style={{ fontSize: '0.88rem', paddingLeft: '1.1rem' }}>
      {claims.map((c, i) => (
        <li key={i} style={{ marginBottom: '0.4rem' }}>
          {c.claim}{' '}
          {c.evidence_ids.length > 0 && (
            <span className="muted">[{c.evidence_ids.join(', ')}]</span>
          )}
          <span className="muted" style={{ marginLeft: '0.4rem', fontSize: '0.76rem' }}>
            ({CLAIM_TYPE_LABEL[c.claim_type] ?? c.claim_type})
          </span>
        </li>
      ))}
    </ul>
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Digital Twin view (Step 7/8/9) — reuses the existing Phase 2 endpoints
  // directly rather than re-deriving this from the analysis result, which
  // only carries a filtered, question-relevant subset as prose.
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

  const analyze = async () => {
    if (!selected || !question.trim()) return
    setBusy(true)
    setError(null)
    try {
      setResult(
        await api.analyzeClinical(selected.id, question.trim(), {
          includeEvidence,
          includePubmed,
          includeModelComparison,
          includeSimulation,
        }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!selected) return <p className="muted">Select a patient on the Intake page first.</p>

  const blocked = result?.safety.status === 'BLOCKED'
  // The current API contract doesn't distinguish "PubMed was queried and
  // came back empty" from "PubMed was queried and failed" (docs/RAG.md,
  // docs/CLINICAL_ANALYSIS.md) — so this notice is honestly phrased to
  // cover both rather than claiming a specific cause we can't verify.
  const pubmedRequestedButAbsent =
    includePubmed && !!result && !result.evidence_findings.some((e) => e.source_type === 'pubmed')

  const rfClaim = result?.model_analysis.find((c) => c.claim.includes('production RandomForest'))
  const xgbClaim = result?.model_analysis.find((c) => c.claim.includes('XGBoost candidate model') && c.claim.includes('assigned a score'))
  const contributionClaims = result?.model_analysis.filter((c) => c.claim.includes('MODEL FEATURE CONTRIBUTIONS') || c.claim.includes('Top model feature contributions')) ?? []
  const comparisonClaim = result?.model_analysis.find((c) => c.claim.includes('fixed historical test set'))
  const conflictClaim = result?.model_analysis.find((c) => c.claim_type === 'uncertainty' && c.claim.includes('different risk tiers'))

  const hba1cChartData = (hba1c?.history ?? []).map((h) => ({
    date: new Date(h.recorded_at).toLocaleDateString(),
    value: h.value,
  }))

  return (
    <>
      <h1>Clinical Analysis</h1>
      <p className="muted">
        Composes the Digital Twin, the production and candidate risk models, retrieved evidence,
        and (optionally) a what-if simulation into one structured, cited analysis — reviewed by the
        Safety Agent before being shown here. Not a diagnosis, not a treatment recommendation.
      </p>
      <ScopeDisclaimer />
      <ErrorNote error={error} />

      <Card title="Ask a clinical question">
        <p className="muted" style={{ marginTop: 0 }}>
          Patient #{selected.id} — {selected.pseudonym}
        </p>
        <textarea
          rows={2}
          style={{ width: '100%' }}
          value={question}
          placeholder="e.g. What factors are relevant to this patient's diabetes risk, especially blood pressure and BMI?"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div className="row" style={{ marginTop: '0.6rem', gap: '1.2rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input type="checkbox" checked={includeEvidence} onChange={(e) => setIncludeEvidence(e.target.checked)} />
            Evidence
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input type="checkbox" checked={includePubmed} onChange={(e) => setIncludePubmed(e.target.checked)} />
            PubMed
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input
              type="checkbox"
              checked={includeModelComparison}
              onChange={(e) => setIncludeModelComparison(e.target.checked)}
            />
            Compare models (RandomForest vs XGBoost)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input
              type="checkbox"
              checked={includeSimulation}
              onChange={(e) => setIncludeSimulation(e.target.checked)}
            />
            What-if simulation
          </label>
        </div>
        <div style={{ marginTop: '0.8rem' }}>
          <button onClick={analyze} disabled={busy || !question.trim()}>
            {busy ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>
      </Card>

      <Card title="Digital Twin">
        {!twin ? (
          <p className="muted">Digital Twin view unavailable for this patient right now.</p>
        ) : (
          <>
            <dl className="kv" style={{ fontSize: '0.86rem' }}>
              {Object.entries({ ...twin.clinical, ...twin.lifestyle }).map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{k}</dt>
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

        {hba1c && hba1c.trend !== 'no_data' && (
          <>
            <h3>HbA1c</h3>
            {hba1cChartData.length > 1 && (
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer>
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
            <p className="muted" style={{ fontSize: '0.78rem' }}>
              Trend across available measurements: <strong>{hba1c.trend}</strong>. A plain description
              of the recorded numbers only — not a diagnostic threshold.
            </p>
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
            {comparisonClaim && (
              <>
                <h3 style={{ marginTop: '0.8rem' }}>Model evaluation metrics</h3>
                <p className="muted" style={{ fontSize: '0.86rem' }}>{comparisonClaim.claim}</p>
              </>
            )}
          </Card>

          {contributionClaims.length > 0 && (
            <Card title="Model feature contributions">
              <p className="muted" style={{ marginTop: 0, fontSize: '0.82rem' }}>
                What each model weighted in producing its score — not a cause of the patient's risk,
                and not a clinical determinant.
              </p>
              <ClaimList claims={contributionClaims} />
            </Card>
          )}

          <Card title="Evidence-backed findings">
            {!includeEvidence && !includePubmed ? (
              <p className="muted">Evidence retrieval was not requested for this analysis.</p>
            ) : result.evidence_findings.length === 0 ? (
              <p className="muted">No sufficiently relevant evidence was retrieved for this query.</p>
            ) : (
              <EvidenceCitations evidence={result.evidence_findings} />
            )}
            {pubmedRequestedButAbsent && (
              <p className="muted" style={{ fontSize: '0.82rem' }}>
                No PubMed evidence was included in this result — either none was sufficiently relevant,
                or PubMed was unavailable for this request. Local evidence above is unaffected.
              </p>
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

          <Card title="Uncertainty / limitations">
            <ul style={{ fontSize: '0.86rem' }}>
              {result.uncertainties.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </Card>

          {includeSimulation && (
            <Card title="What-if simulation">
              {!result.simulation ? (
                <p className="muted">Simulation unavailable for this profile/request.</p>
              ) : result.simulation.status === 'unavailable_for_profile' ? (
                <p className="muted">Simulation unavailable for this profile/request. {result.simulation.unavailable_reason}</p>
              ) : (
                <>
                  <p className="muted" style={{ marginTop: 0 }}>
                    <strong>MODEL SIMULATION</strong> — {result.simulation.label}. Not a predicted
                    clinical outcome.
                  </p>
                  <p>{result.simulation.summary_text}</p>
                </>
              )}
            </Card>
          )}

          <Card title="Agent trace">
            <AgentTrace trace={result.trace} />
          </Card>
        </>
      )}
    </>
  )
}
