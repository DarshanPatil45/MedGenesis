import {
  ArrowRight,
  BookOpen,
  Fingerprint,
  FlaskConical,
  GitCompare,
  Library,
  Sparkles,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type {
  ClinicalAnalysis,
  ClinicalClaim,
  DigitalTwin as DigitalTwinData,
  EvidenceSource,
  LabTrend,
  ModelComparison,
} from '../api/types'
import { usePatients } from '../PatientContext'
import { AgentTrace, ErrorNote, RiskBadge } from '../components/common'
import { DigitalTwin } from '../components/clinical/DigitalTwin'
import { EvidencePanel } from '../components/clinical/EvidencePanel'
import { ModelResults } from '../components/clinical/ModelResults'
import { RankedFeatureList, ShapBars } from '../components/clinical/SHAPChart'
import { SafetyStatus } from '../components/clinical/SafetyStatus'
import { ScopeDisclaimer } from '../components/SafetyBanner'

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
    icon: BookOpen,
  },
  {
    key: 'includePubmed' as const,
    label: 'PubMed literature',
    description: 'Include PubMed literature when available.',
    icon: Library,
  },
  {
    key: 'includeModelComparison' as const,
    label: 'Compare models',
    description: 'Show the candidate XGBoost model alongside the production model.',
    icon: GitCompare,
  },
  {
    key: 'includeSimulation' as const,
    label: 'What-if simulation',
    description: 'Run an available model-based scenario.',
    icon: FlaskConical,
  },
]

const FLOW_STEPS = ['Patient', 'Digital Twin', 'Models', 'Evidence', 'AI Synthesis', 'Safety']

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

function FlowStrip({ reached }: { reached: number }) {
  return (
    <div className="flow-strip" aria-hidden="true">
      {FLOW_STEPS.map((step, i) => (
        <span key={step} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {i > 0 && <ArrowRight size={12} className="flow-strip-arrow" />}
          <span className={`flow-strip-step${i < reached ? ' current' : ''}`}>{step}</span>
        </span>
      ))}
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
  const reduceMotion = useReducedMotion()

  // Digital Twin view — reuses the existing Phase 2 endpoints directly
  // rather than re-deriving this from the analysis result, which only
  // carries a filtered, question-relevant subset as prose.
  const [twin, setTwin] = useState<DigitalTwinData | null>(null)
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

  const contributionClaims =
    result?.model_analysis.filter(
      (c) => c.claim.includes('MODEL FEATURE CONTRIBUTIONS') || c.claim.includes('Top model feature contributions'),
    ) ?? []
  const rfContributionClaim = contributionClaims.find((c) => c.claim.includes('RandomForest'))
  const xgbContributionClaim = contributionClaims.find((c) => c.claim.includes('XGBoost'))
  const otherContributionClaims = contributionClaims.filter(
    (c) => c !== rfContributionClaim && c !== xgbContributionClaim,
  )
  // The two headline score claims — already shown explicitly under
  // "Model Intelligence" (production vs candidate), so "Model signals"
  // below must exclude them to avoid showing the same sentence twice.
  const rfScoreClaim = result?.model_analysis.find(
    (c) => c.claim.includes('production RandomForest') && c.claim.includes('assigned a score'),
  )
  const xgbScoreClaim = result?.model_analysis.find(
    (c) => c.claim.includes('XGBoost candidate model') && c.claim.includes('assigned a score'),
  )
  // "Model signals" — every remaining model_analysis claim that isn't a
  // feature contribution or a headline score (those get their own
  // sections below).
  const modelSignalClaims =
    result?.model_analysis.filter(
      (c) => !contributionClaims.includes(c) && c !== rfScoreClaim && c !== xgbScoreClaim,
    ) ?? []

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
      <motion.div
        className="section-block"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.65, ease: [0.2, 0, 0, 1] }}
      >
        <span className="eyebrow">
          <Sparkles /> Clinical intelligence
        </span>
        <h1 className="section-title">Clinical Analysis</h1>
        <p className="section-lead">
          Grounded in this patient's longitudinal Digital Twin data, the production and candidate
          risk models, and retrieved medical evidence — composed into one structured, cited
          analysis and reviewed by the Safety Agent before being shown here.
        </p>
        <FlowStrip reached={result ? 6 : twin ? 2 : 1} />
      </motion.div>

      <ScopeDisclaimer />
      <ErrorNote error={error} />

      <div className="command-bar">
        <label htmlFor="clinical-question" style={{ display: 'block', marginBottom: '0.4rem' }}>
          Ask a question about the patient's longitudinal state
        </label>
        <textarea
          id="clinical-question"
          rows={2}
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
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            Ctrl/Cmd+Enter to analyze
          </span>
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            {questionRemaining} characters remaining
          </span>
        </div>

        <div className="command-bar-footer">
          <div className="chip-row">
            {ANALYSIS_OPTIONS.map((opt) => (
              <label
                key={opt.key}
                className={`chip${optionValues[opt.key] ? ' selected' : ''}`}
                title={opt.description}
              >
                <opt.icon size={14} aria-hidden="true" />
                {opt.label}
                <input
                  type="checkbox"
                  checked={optionValues[opt.key]}
                  onChange={(e) => optionSetters[opt.key](e.target.checked)}
                />
              </label>
            ))}
          </div>
          <button className="command-bar-submit" onClick={() => void analyze()} disabled={busy || !question.trim()}>
            {busy ? 'Analyzing…' : 'Analyze Patient'}
            <ArrowRight size={15} aria-hidden="true" />
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
      </div>

      <div className="section-block" style={{ marginTop: 'var(--space-7)' }}>
        <span className="micro-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Fingerprint size={13} /> Digital Twin
        </span>
        <DigitalTwin twin={twin} hba1c={hba1c} />
      </div>

      {result && (
        <>
          {blocked ? (
            <div className="section-block">
              <h2 className="section-title" style={{ fontSize: '1.2rem' }}>
                Analysis withheld
              </h2>
              <p className="muted">
                The Safety Agent blocked this analysis. Nothing below reflects the withheld content
                — only what the safety layer approved for display.
              </p>
            </div>
          ) : (
            <div className="workspace">
              <div className="workspace-main">
                <section className="section-block">
                  <h2 className="section-title" style={{ fontSize: '1.25rem' }}>
                    AI Synthesis
                  </h2>

                  <div style={{ marginBottom: 'var(--space-5)' }}>
                    <span className="micro-label">Patient observations</span>
                    <ClaimList claims={result.patient_summary} />
                  </div>

                  <div style={{ marginBottom: 'var(--space-5)' }}>
                    <span className="micro-label">Model signals</span>
                    <ClaimList claims={modelSignalClaims} />
                  </div>

                  <div style={{ marginBottom: 'var(--space-5)' }}>
                    <span className="micro-label">Integrated synthesis</span>
                    <ClaimList claims={result.integrated_analysis} />
                    {result.safety_flags.length > 0 && (
                      <p className="muted" style={{ fontSize: '0.78rem' }}>
                        Generation flags: {result.safety_flags.join(' ')}
                      </p>
                    )}
                  </div>

                  <div>
                    <span className="micro-label">Uncertainty & limitations</span>
                    {result.uncertainties.length === 0 ? (
                      <p className="muted">No uncertainty notes were returned for this analysis.</p>
                    ) : (
                      <ul style={{ fontSize: '0.86rem' }}>
                        {result.uncertainties.map((u, i) => (
                          <li key={i}>{u}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>

                <section className="section-block">
                  <h2 className="section-title" style={{ fontSize: '1.25rem' }}>
                    Model Intelligence
                  </h2>
                  <p className="section-lead" style={{ marginBottom: 'var(--space-4)' }}>
                    Production vs candidate.
                  </p>
                  <ModelResults result={result} comparison={comparison} includeModelComparison={includeModelComparison} />
                </section>

                {contributionClaims.length > 0 && (
                  <section className="section-block">
                    <h2 className="section-title" style={{ fontSize: '1.25rem' }}>
                      Why this prediction?
                    </h2>
                    <p className="section-lead" style={{ marginBottom: 'var(--space-4)' }}>
                      Feature contributions describe how model inputs influenced the prediction.
                      They do not establish causality.
                    </p>
                    {rfContributionClaim && (
                      <div style={{ marginBottom: xgbContributionClaim ? '1.2rem' : 0 }}>
                        <h3>RandomForest — aggregate importance</h3>
                        <RankedFeatureList text={rfContributionClaim.claim} />
                        <EvidenceRefs ids={rfContributionClaim.evidence_ids} />
                      </div>
                    )}
                    {xgbContributionClaim && (
                      <div>
                        <h3>XGBoost — this patient (SHAP)</h3>
                        <ShapBars text={xgbContributionClaim.claim} />
                        <EvidenceRefs ids={xgbContributionClaim.evidence_ids} />
                      </div>
                    )}
                    {otherContributionClaims.length > 0 && <ClaimList claims={otherContributionClaims} />}
                  </section>
                )}

                <section className="section-block">
                  <h2 className="section-title" style={{ fontSize: '1.25rem' }}>
                    Evidence
                  </h2>
                  <EvidencePanel
                    includeEvidence={includeEvidence}
                    includePubmed={includePubmed}
                    localEvidence={localEvidence}
                    pubmedEvidence={pubmedEvidence}
                    total={indexedEvidence.length}
                  />
                </section>

                {includeSimulation && (
                  <section className="section-block">
                    <h2 className="section-title" style={{ fontSize: '1.25rem' }}>
                      Model Simulation
                    </h2>
                    {!result.simulation ? (
                      <p className="muted">Simulation unavailable for this profile/request.</p>
                    ) : result.simulation.status === 'unavailable_for_profile' ? (
                      <p className="muted">
                        Simulation unavailable for this profile/request. {result.simulation.unavailable_reason}
                      </p>
                    ) : (
                      <>
                        <p className="muted" style={{ marginTop: 0 }}>
                          {result.simulation.label}. Not a predicted clinical outcome, not a
                          guaranteed result.
                        </p>
                        <p>{result.simulation.summary_text}</p>
                      </>
                    )}
                  </section>
                )}

                <details className="card">
                  <summary className="row" style={{ gap: '0.5rem' }}>
                    Analysis details (trace)
                  </summary>
                  <div className="details-body">
                    <AgentTrace trace={result.trace} />
                  </div>
                </details>
              </div>

              <aside className="workspace-side">
                <div className="signal-panel">
                  <span className="signal-panel-label">Patient signals</span>
                  <div className="signal-row">
                    <span className="muted">Risk tier</span>
                    <RiskBadge tier={result.production_risk_tier} />
                  </div>
                  <div className="signal-row">
                    <span className="muted">Model</span>
                    <span>Production · RandomForest</span>
                  </div>
                  {twin && (
                    <div className="signal-row">
                      <span className="muted">BMI</span>
                      <span>{String((twin.clinical as Record<string, unknown>).bmi ?? '—')}</span>
                    </div>
                  )}
                  {hba1c?.latest && (
                    <div className="signal-row">
                      <span className="muted">HbA1c</span>
                      <span>
                        {hba1c.latest.value}
                        {hba1c.latest.unit ?? '%'}
                      </span>
                    </div>
                  )}
                  <div className="signal-row">
                    <span className="muted">Safety</span>
                    <span
                      style={{
                        color:
                          result.safety.status === 'APPROVED'
                            ? 'var(--low)'
                            : result.safety.status === 'BLOCKED'
                              ? 'var(--high)'
                              : 'var(--moderate)',
                        fontWeight: 600,
                        fontSize: '0.8rem',
                      }}
                    >
                      {result.safety.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              </aside>
            </div>
          )}

          <SafetyStatus safety={result.safety} />
        </>
      )}
    </>
  )
}
