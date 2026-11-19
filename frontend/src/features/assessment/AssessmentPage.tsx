import { Bar, BarChart, Cell, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Gauge, Play, UserRound } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { ClinicalAnalysis, ClinicalClaim, Safety, Screening } from '../../api/types'
import {
  Button,
  Card,
  CardLabel,
  Chip,
  CountUp,
  EmptyState,
  ErrorState,
  Skeleton,
  StageHeader,
  Stat,
  chart,
  color,
  resultReveal,
  riskColor,
  riskFill,
  safetyColor,
} from '../../design-system'
import { PageContainer } from '../../layouts/AppShell'
import { usePatients } from '../../PatientContext'
import { SafetyGate } from '../safety/SafetyGate'
import { EvidenceColumn, type IndexedEvidence } from '../analysis/EvidenceColumn'
import { ShapDiverging } from '../analysis/ShapDiverging'

/**
 * Deliberately avoids every phrase in clinical_agent.py's
 * CLINICAL_CONCEPT_KEYWORDS (blood pressure, weight, activity, smoking,
 * alcohol, heart, stroke, mobility, mental, general health, diet, ...).
 * That keeps `_relevant_clinical_fields` on its documented fallback path —
 * the production model's own top-5 real feature importances — so "Key
 * factors" is grounded in what the model actually weighs, not a phrase
 * this default happened to contain.
 */
const DEFAULT_QUESTION =
  "Summarize this patient's diabetes risk profile based on their full record and the risk model's own most important factors."

const SAFETY_SEVERITY: Record<string, number> = { APPROVED: 0, FLAGGED_FOR_CLINICIAN_REVIEW: 1, BLOCKED: 2 }

/**
 * Screening and Clinical Analysis each run their own Safety Agent pass, so
 * an Assessment that merges both pages ends up with two verdicts. Rather
 * than showing two gates — which would re-expose the two-agent seam this
 * page exists to hide — this folds them into the one, more restrictive
 * verdict. Every reason/banner/disclaimer shown is still verbatim from the
 * backend; nothing here is invented, only combined.
 */
function mergeSafety(a: Safety, b: Safety): Safety {
  const worse = (SAFETY_SEVERITY[a.status] ?? 0) >= (SAFETY_SEVERITY[b.status] ?? 0) ? a : b
  const other = worse === a ? b : a
  const reasons = [...a.reasons, ...b.reasons].filter((r, i, arr) => arr.indexOf(r) === i)
  return {
    status: worse.status,
    reasons,
    banner: worse.banner ?? other.banner,
    disclaimer: worse.disclaimer ?? other.disclaimer,
    policy_version: worse.policy_version,
  }
}

function RiskGauge({ value, tier }: { value: number; tier: string | null }) {
  const key = (tier ?? '').toLowerCase()
  const arc = riskFill[key] ?? color.tealBright
  const label = riskColor[key] ?? color.teal
  return (
    <div className="relative h-44 w-44 shrink-0">
      <ResponsiveContainer>
        <RadialBarChart
          innerRadius="74%"
          outerRadius="100%"
          data={[{ name: 'risk', value: value * 100, fill: arc }]}
          startAngle={220}
          endAngle={-40}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background={{ fill: '#EDF1F7' }} dataKey="value" cornerRadius={999} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-4xl font-bold tabular-nums" style={{ color: label }}>
          {(value * 100).toFixed(0)}
          <span className="text-xl">%</span>
        </span>
        <span className="mt-1 text-[0.6rem] font-bold tracking-[0.16em] text-ink-3 uppercase">Risk score</span>
      </div>
    </div>
  )
}

function ClaimList({ claims, emptyText }: { claims: ClinicalClaim[]; emptyText: string }) {
  if (!claims?.length) return <p className="text-sm text-ink-3">{emptyText}</p>
  return (
    <ul className="space-y-3">
      {claims.map((c, i) => (
        <li key={i} className="text-sm leading-relaxed text-ink">
          {c.claim}
          {c.evidence_ids.length > 0 &&
            c.evidence_ids.map((id) => (
              <a
                key={id}
                href={`#${id}`}
                className="mx-0.5 rounded border border-teal/30 bg-teal/10 px-1.5 py-px align-middle font-mono text-[0.64rem] font-bold text-teal hover:bg-teal/20"
              >
                {id}
              </a>
            ))}
        </li>
      ))}
    </ul>
  )
}

export function AssessmentPage() {
  const { selected } = usePatients()
  const [screening, setScreening] = useState<Screening | null>(null)
  const [clinical, setClinical] = useState<ClinicalAnalysis | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reduced = useReducedMotion()

  // Reset per-patient results when the selected patient changes, so a
  // stale assessment is never shown against a different record.
  useEffect(() => {
    setScreening(null)
    setClinical(null)
  }, [selected?.id])

  const run = async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const [s, c] = await Promise.all([
        api.runScreening(selected.id),
        api.analyzeClinical(selected.id, DEFAULT_QUESTION, {
          includeEvidence: true,
          includePubmed: true,
          includeModelComparison: true,
          includeSimulation: false,
        }),
      ])
      setScreening(s)
      setClinical(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!selected) {
    return (
      <PageContainer className="py-16">
        <EmptyState
          icon={UserRound}
          title="No patient selected"
          reason="Assessment screens one patient's current Digital Twin state and grounds the result in evidence."
          action={<Chip tone="teal">Choose a patient from the chip in the top bar</Chip>}
        />
      </PageContainer>
    )
  }

  const result = screening && clinical ? { screening, clinical } : null
  const safety = result ? mergeSafety(result.screening.safety, result.clinical.safety) : null
  const blocked = safety?.status === 'BLOCKED'

  const contribution =
    result?.clinical.model_analysis.filter(
      (c) => c.claim.includes('MODEL FEATURE CONTRIBUTIONS') || c.claim.includes('Top model feature contributions'),
    ) ?? []
  const xgbContribution = contribution.find((c) => c.claim.includes('XGBoost'))

  const features = Object.entries(result?.screening.top_features ?? {}).map(([name, value]) => ({
    name,
    value: Number(value.toFixed(4)),
  }))

  const indexed: IndexedEvidence[] = result?.clinical.evidence_findings.map((source, i) => ({ source, index: i + 1 })) ?? []
  const local = indexed.filter((e) => e.source.source_type !== 'pubmed')
  const pubmed = indexed.filter((e) => e.source.source_type === 'pubmed')

  return (
    <>
      <section className="border-b border-border-strong">
        <PageContainer className="py-12 lg:py-16">
          <StageHeader
            eyebrow="Assessment"
            eyebrowIcon={Gauge}
            title="Assessment"
            subtitle={`A single, evidence-grounded read of #${selected.id} · ${selected.pseudonym}'s diabetes-risk screening — the factors behind it, supporting evidence, and the safety review.`}
            actions={
              <Button variant="primary" size="lg" onClick={() => void run()} disabled={busy}>
                <Play size={15} />
                {busy ? 'Assessing…' : result ? 'Re-run assessment' : 'Run assessment'}
              </Button>
            }
            metrics={
              result && safety ? (
                <>
                  <Stat
                    label="Risk score"
                    emphasis="key"
                    value={
                      typeof result.screening.risk_probability === 'number' ? (
                        <CountUp value={result.screening.risk_probability * 100} decimals={1} suffix="%" />
                      ) : (
                        '—'
                      )
                    }
                    hint="production model"
                  />
                  <Stat
                    label="Risk tier"
                    value={
                      <span style={{ color: riskColor[(result.screening.risk_tier ?? '').toLowerCase()] }}>
                        {result.screening.risk_tier ?? '—'}
                      </span>
                    }
                  />
                  <Stat
                    label="Evidence"
                    value={<CountUp value={indexed.length} />}
                    hint={`${local.length} local · ${pubmed.length} PubMed`}
                  />
                  <Stat
                    label="Safety"
                    value={<span style={{ color: safetyColor[safety.status] }}>{safety.status.replace(/_/g, ' ')}</span>}
                  />
                </>
              ) : undefined
            }
          />
        </PageContainer>
      </section>

      <PageContainer className="py-10 lg:py-12">
        <ErrorState error={error} onRetry={() => void run()} />

        {busy && !result && (
          <div className="grid gap-8 lg:grid-cols-12" role="status" aria-label="Running assessment">
            <div className="lg:col-span-5"><Skeleton className="h-64" /></div>
            <div className="lg:col-span-7"><Skeleton className="h-64" /></div>
          </div>
        )}

        {!busy && !result && (
          <EmptyState
            icon={Gauge}
            title="No assessment yet"
            reason="Run an assessment to screen this patient's current recorded state, rank the contributing factors, and ground the result in retrieved medical evidence."
            action={<Button variant="primary" onClick={() => void run()}>Run assessment</Button>}
          />
        )}

        {result && safety && (
          <motion.div variants={resultReveal} initial={reduced ? false : 'hidden'} animate="visible">
            {blocked ? (
              <div>
                <p className="mb-5 max-w-2xl text-sm text-ink-2">
                  The safety review blocked this assessment. Nothing below reflects withheld content — only what
                  passed review is shown.
                </p>
                <SafetyGate safety={safety} />
              </div>
            ) : (
              <>
                {/* ── Risk screening ── */}
                <section className="mb-10">
                  <CardLabel>Risk screening</CardLabel>
                  {result.screening.status === 'unavailable_for_profile' ? (
                    <EmptyState
                      icon={Gauge}
                      title="Model declined to score this profile"
                      reason={`${result.screening.unavailable_reason} This is deliberate: forcing a prediction from a substituted value would return a confident-looking number with no basis, so the model refuses instead of guessing.`}
                    />
                  ) : (
                    <Card layer="data" pad="lg">
                      <div className="flex flex-wrap items-center gap-6">
                        <RiskGauge value={result.screening.risk_probability ?? 0} tier={result.screening.risk_tier} />
                        <div className="min-w-0 flex-1">
                          <span className="mb-1 block text-[0.6rem] font-bold tracking-[0.14em] text-ink-3 uppercase">
                            Risk tier
                          </span>
                          <span
                            className="text-lg font-semibold"
                            style={{ color: riskColor[(result.screening.risk_tier ?? '').toLowerCase()] }}
                          >
                            {result.screening.risk_tier ?? '—'}
                          </span>
                          <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-2">
                            {result.screening.summary_text}
                          </p>
                        </div>
                      </div>
                    </Card>
                  )}
                </section>

                {/* ── Key factors ── */}
                {(features.length > 0 || xgbContribution) && (
                  <section className="mb-10">
                    <CardLabel>Key factors</CardLabel>
                    <p className="mb-5 max-w-3xl text-sm leading-relaxed text-ink-2">
                      What the model weighs — generally, across patients like this one, and specifically for this
                      patient's own recorded values.
                    </p>
                    <div className="grid gap-6 lg:grid-cols-2">
                      {features.length > 0 && (
                        <Card layer="data" pad="md">
                          <CardLabel>Generally important</CardLabel>
                          <div className="h-56 w-full">
                            <ResponsiveContainer>
                              <BarChart data={features} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 46 }}>
                                <XAxis type="number" stroke={chart.axis} fontSize={11} tickLine={false} axisLine={false} />
                                <YAxis type="category" dataKey="name" width={104} stroke={chart.axis} fontSize={11} tickLine={false} axisLine={false} />
                                <Tooltip cursor={{ fill: '#141A2280' }} contentStyle={chart.tooltip} />
                                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>
                                  {features.map((_, i) => (
                                    <Cell key={i} fill={color.tealBright} fillOpacity={1 - i * 0.14} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </Card>
                      )}
                      {xgbContribution && (
                        <Card layer="data" pad="md">
                          <CardLabel>For this patient</CardLabel>
                          <ShapDiverging text={xgbContribution.claim} />
                        </Card>
                      )}
                    </div>
                  </section>
                )}

                {/* ── Evidence ── */}
                <section className="mb-10">
                  <EvidenceColumn local={local} pubmed={pubmed} requested={true} fused={true} />
                </section>

                {/* ── Clinical context ── */}
                <section className="mb-10">
                  <CardLabel>Clinical context</CardLabel>
                  <div className="grid gap-8 lg:grid-cols-2">
                    <div>
                      <h2 className="mb-2 text-xs font-semibold tracking-wide text-ink-2 uppercase">From the record</h2>
                      <ClaimList claims={result.clinical.patient_summary} emptyText="No record-level observations returned." />
                    </div>
                    <div>
                      <h2 className="mb-2 text-xs font-semibold tracking-wide text-ink-2 uppercase">Integrated read</h2>
                      <ClaimList claims={result.clinical.integrated_analysis} emptyText="No integrated synthesis returned." />
                      {result.clinical.uncertainties.length > 0 && (
                        <div className="mt-4 rounded-[14px] border border-amber/25 bg-amber/6 p-4">
                          <h3 className="mb-2 text-[0.64rem] font-bold tracking-[0.16em] text-amber uppercase">Uncertainty</h3>
                          <ul className="space-y-2">
                            {result.clinical.uncertainties.map((u, i) => (
                              <li key={i} className="text-xs leading-relaxed text-ink-2">{u}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* ── Safety status ── */}
                <section className="mb-10">
                  <CardLabel>Safety status</CardLabel>
                  <SafetyGate safety={safety} />
                </section>

                {/* ── Advanced ── */}
                <details className="data-surface mb-10 rounded-[14px]">
                  <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-ink">Advanced</summary>
                  <div className="space-y-4 border-t border-border-strong px-5 py-4">
                    <p className="text-xs text-ink-3">
                      Generated by {result.clinical.generated_by} · model {result.screening.model_version}
                    </p>
                    <div>
                      <p className="mb-1 text-[0.64rem] font-bold tracking-[0.16em] text-ink-3 uppercase">
                        Screening trace · {result.screening.trace.length} steps
                      </p>
                      <ol className="space-y-1 text-xs text-ink-2">
                        {result.screening.trace.map((t, i) => (
                          <li key={i} className="border-b border-border-strong/50 py-1 last:border-0">{t}</li>
                        ))}
                      </ol>
                    </div>
                    <div>
                      <p className="mb-1 text-[0.64rem] font-bold tracking-[0.16em] text-ink-3 uppercase">
                        Analysis trace · {result.clinical.trace.length} steps
                      </p>
                      <ol className="space-y-1 text-xs text-ink-2">
                        {result.clinical.trace.map((t, i) => (
                          <li key={i} className="border-b border-border-strong/50 py-1 last:border-0">{t}</li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </details>
              </>
            )}
          </motion.div>
        )}
      </PageContainer>
    </>
  )
}
