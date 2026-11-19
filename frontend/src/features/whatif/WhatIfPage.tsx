import { FlaskConical, Play, RotateCcw, UserRound } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../api/client'
import type { Simulation } from '../../api/types'
import {
  Button,
  Card,
  CardLabel,
  Chip,
  ChipButton,
  CountUp,
  EmptyState,
  ErrorState,
  LabeledSlider,
  Skeleton,
  StageHeader,
  Stat,
  chart,
  color,
  resultReveal,
  riskColor,
} from '../../design-system'
import { PageContainer } from '../../layouts/AppShell'
import { usePatients } from '../../PatientContext'
import { SafetyGate } from '../safety/SafetyGate'

/**
 * Only the deltas the simulation agent actually supports
 * (app/agents/simulation_rules.py::SUPPORTED_DELTAS). Blood pressure and
 * glucose are deliberately absent — BRFSS records neither, so the trained
 * model has nothing for them to act on.
 */
const DEFAULTS = { weight_kg_delta: -5, bmi_delta: 0, activity_minutes_delta: 0, smoker_delta: 0, horizon_weeks: 12 }

type Params = typeof DEFAULTS

/** Phrasings the deterministic parser actually recognises (simulation_nlp.py). */
const TEXT_EXAMPLES = [
  'lost weight and exercised more',
  'quit smoking over 8 weeks',
  'lost 10 lbs and started walking',
]

export function WhatIfPage() {
  const { selected } = usePatients()
  const [params, setParams] = useState<Params>(DEFAULTS)
  const [scenarioText, setScenarioText] = useState('')
  const [result, setResult] = useState<Simulation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reduced = useReducedMotion()

  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams((p) => ({ ...p, [k]: v }))

  const submit = async (hypothesis: Record<string, number>, text?: string) => {
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

  const runSliders = () => {
    const hypothesis: Record<string, number> = {}
    for (const [k, v] of Object.entries(params)) if (v !== 0 || k === 'horizon_weeks') hypothesis[k] = v
    void submit(hypothesis)
  }

  /**
   * Free-text scenarios must be sent with an EMPTY hypothesis: the agent
   * only parses `text` when no structured change is supplied
   * (simulation_agent.py:88). Sending the sliders too would silently
   * discard whatever was typed.
   */
  const runText = (text: string) => {
    if (!text.trim()) return
    void submit({}, text.trim())
  }

  if (!selected) {
    return (
      <PageContainer className="py-16">
        <EmptyState
          icon={UserRound}
          title="No patient selected"
          reason="A scenario is projected from one patient's current recorded state."
          action={<Chip tone="teal">Choose a patient from the chip in the top bar</Chip>}
        />
      </PageContainer>
    )
  }

  const baseline = result?.trajectory[0]?.risk_probability
  const final = result?.trajectory[result.trajectory.length - 1]
  const delta = baseline !== undefined && final ? final.risk_probability - baseline : null

  return (
    <>
      <section className="border-b border-border-strong">
        <PageContainer className="py-12 lg:py-16">
          <StageHeader
            eyebrow="What-if"
            eyebrowIcon={FlaskConical}
            title="What-if"
            subtitle="Probe how the trained screening model responds to hypothetical changes. The projection is a transparent, documented heuristic — not a validated physiological model, and not a forecast of a real clinical outcome."
            actions={
              <Chip tone="amber" dot>
                Simulation only — the Digital Twin is not modified
              </Chip>
            }
            /* Populated only once a simulation has actually run — before
               that there is no baseline/projected pair to report. */
            metrics={
              result && baseline !== undefined && final ? (
                <>
                  <Stat label="Baseline" value={<CountUp value={baseline * 100} decimals={1} suffix="%" />} />
                  <Stat
                    label="Projected"
                    emphasis="key"
                    value={<CountUp value={final.risk_probability * 100} decimals={1} suffix="%" />}
                    hint={`at ${params.horizon_weeks} weeks`}
                  />
                  <Stat
                    label="Δ from baseline"
                    value={
                      <span style={{ color: delta !== null && delta < 0 ? color.teal : delta !== null && delta > 0 ? color.rose : undefined }}>
                        {delta !== null ? `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} pts` : '—'}
                      </span>
                    }
                  />
                  <Stat label="Horizon" value={<CountUp value={params.horizon_weeks} suffix=" wks" />} />
                </>
              ) : undefined
            }
          />
        </PageContainer>
      </section>

      <PageContainer className="py-10 lg:py-12">
        <ErrorState error={error} onRetry={runSliders} />

        <div className="grid gap-8 lg:grid-cols-12">
          {/* Controls — 4 cols */}
          <div className="min-w-0 lg:col-span-4">
            {/* ── Free-text scenario ── */}
            <CardLabel>Describe a scenario</CardLabel>
            <Card layer="data" pad="lg" className="mb-4">
              <label htmlFor="scenario-text" className="sr-only">
                Describe a scenario in your own words
              </label>
              <div className="flex gap-2">
                <input
                  id="scenario-text"
                  value={scenarioText}
                  onChange={(e) => setScenarioText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runText(scenarioText)}
                  placeholder="e.g. lost 10 lbs and started exercising"
                  className="min-w-0 flex-1 rounded-[10px] border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus-visible:border-teal"
                />
                <Button variant="secondary" onClick={() => runText(scenarioText)} disabled={busy || !scenarioText.trim()}>
                  Parse
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {TEXT_EXAMPLES.map((ex) => (
                  <ChipButton key={ex} disabled={busy} onClick={() => { setScenarioText(ex); runText(ex) }}>
                    {ex}
                  </ChipButton>
                ))}
              </div>

              <p className="mt-3 text-[0.68rem] leading-relaxed text-ink-3">
                A small deterministic parser — not a language model — maps phrases onto the same four deltas. If it
                can't confidently read your text it says so rather than guessing, and what it understood is listed
                under the assumptions.
              </p>
            </Card>

            <div className="mb-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-border-strong" aria-hidden="true" />
              <span className="text-[0.62rem] font-bold tracking-[0.16em] text-ink-3 uppercase">or set exact values</span>
              <span className="h-px flex-1 bg-border-strong" aria-hidden="true" />
            </div>

            <CardLabel>Scenario parameters</CardLabel>
            <Card layer="data" pad="lg">
              <div className="space-y-6">
                <LabeledSlider
                  id="p-weight" label="Weight change" unit=" kg" min={-25} max={25}
                  value={params.weight_kg_delta} onChange={(v) => set('weight_kg_delta', v)}
                />
                <LabeledSlider
                  id="p-bmi" label="BMI change" min={-10} max={10} step={0.5}
                  value={params.bmi_delta} onChange={(v) => set('bmi_delta', v)}
                />
                <LabeledSlider
                  id="p-activity" label="Physical activity" unit=" min" min={-60} max={60} step={60}
                  value={params.activity_minutes_delta} onChange={(v) => set('activity_minutes_delta', v)}
                  hint="Binary in the trained model: −60 becomes inactive, +60 becomes active."
                />
                <LabeledSlider
                  id="p-smoker" label="Smoking status" min={-1} max={1}
                  value={params.smoker_delta} onChange={(v) => set('smoker_delta', v)}
                  hint="−1 quits, +1 starts."
                />
                <LabeledSlider
                  id="p-horizon" label="Horizon" unit=" wk" min={4} max={52} step={4}
                  value={params.horizon_weeks} onChange={(v) => set('horizon_weeks', v)}
                />
              </div>

              <div className="mt-7 flex gap-2">
                <Button variant="primary" className="flex-1" onClick={runSliders} disabled={busy}>
                  <Play size={14} />
                  {busy ? 'Projecting…' : 'Run scenario'}
                </Button>
                <Button variant="ghost" onClick={() => setParams(DEFAULTS)} aria-label="Reset parameters">
                  <RotateCcw size={14} />
                </Button>
              </div>

              <p className="mt-4 text-[0.68rem] leading-relaxed text-ink-3">
                Blood pressure and glucose are not offered: the CDC BRFSS dataset records neither, so the model has no
                input for them.
              </p>
            </Card>
          </div>

          {/* Result — 8 cols */}
          <div className="lg:col-span-8">
            {busy && !result && (
              <div role="status" aria-label="Projecting">
                <Skeleton className="mb-4 h-24" />
                <Skeleton className="h-72" />
              </div>
            )}

            {!busy && !result && (
              <EmptyState
                icon={FlaskConical}
                title="No scenario run yet"
                reason="Adjust the parameters and run a scenario to see how the model's projected score responds."
              />
            )}

            {result && (
              <motion.div variants={resultReveal} initial={reduced ? false : 'hidden'} animate="visible">
                {result.status === 'unavailable_for_profile' ? (
                  <EmptyState icon={FlaskConical} title="Scenario not run" reason={result.unavailable_reason ?? undefined} />
                ) : (
                  <>
                    {/* Before / after diff */}
                    <CardLabel>Baseline vs scenario</CardLabel>
                    <Card layer="data" pad="lg" className="mb-6">
                      <div className="mb-6 flex flex-wrap items-center gap-2">
                        <Chip tone="amber" dot>Simulated</Chip>
                        <span className="text-sm text-ink-2">{result.label}</span>
                      </div>

                      {baseline !== undefined && final && (
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 sm:gap-8">
                          <div className="text-right">
                            <span className="block text-[0.6rem] font-bold tracking-[0.14em] text-ink-3 uppercase">
                              Baseline · week {result.trajectory[0].week}
                            </span>
                            <span className="mt-1 block font-mono text-4xl font-bold text-ink-2 tabular-nums">
                              {(baseline * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="flex flex-col items-center gap-1.5">
                            <span className="h-px w-8 bg-border-strong sm:w-16" />
                            {delta !== null && (
                              <motion.span
                                className="font-mono text-sm font-bold tabular-nums"
                                style={{ color: delta < 0 ? color.tealBright : delta > 0 ? color.rose : color.ink3 }}
                                initial={reduced ? false : { opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.25 }}
                              >
                                {delta > 0 ? '+' : ''}
                                {(delta * 100).toFixed(1)} pts
                              </motion.span>
                            )}
                            <span className="h-px w-8 bg-border-strong sm:w-16" />
                          </div>
                          <div>
                            <span className="block text-[0.6rem] font-bold tracking-[0.14em] text-amber uppercase">
                              Scenario · week {final.week}
                            </span>
                            <span
                              className="mt-1 block font-mono text-4xl font-bold tabular-nums"
                              style={{ color: riskColor[final.risk_tier.toLowerCase()] }}
                            >
                              {(final.risk_probability * 100).toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      )}
                    </Card>

                    <Card layer="data" pad="md" className="mb-6">
                      <div className="h-72 w-full">
                        <ResponsiveContainer>
                          <LineChart data={result.trajectory} margin={{ top: 8, right: 60, bottom: 10, left: -12 }}>
                            <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                            <XAxis dataKey="week" stroke={chart.axis} fontSize={11} tickLine={false}
                              label={{ value: 'week', position: 'insideBottom', offset: -6, fontSize: 11, fill: chart.axis }} />
                            <YAxis stroke={chart.axis} fontSize={11} tickLine={false} axisLine={false} domain={[0, 1]}
                              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                            <Tooltip contentStyle={chart.tooltip}
                              formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
                              labelFormatter={(l) => `Week ${l}`} />
                            {baseline !== undefined && (
                              <ReferenceLine y={baseline} stroke={chart.axis} strokeDasharray="4 4"
                                label={{ value: 'baseline', fontSize: 10, position: 'right', fill: chart.axis }} />
                            )}
                            <Line type="monotone" dataKey="risk_probability" name="Simulated score"
                              stroke={color.amber} strokeWidth={2.5}
                              dot={{ r: 3.5, fill: color.amber, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-ink-2">{result.summary_text}</p>
                    </Card>

                    <CardLabel>Delta model assumptions</CardLabel>
                    <Card layer="data" pad="md" className="mb-6">
                      <ul className="space-y-2">
                        {result.assumptions.map((a, i) => (
                          <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink-2">
                            <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber/60" />
                            {a}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </>
                )}

                <details className="data-surface mb-6 rounded-[14px]">
                  <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-ink">
                    Agent trace · {result.trace.length} steps
                  </summary>
                  <ol className="border-t border-border-strong px-5 py-4">
                    {result.trace.map((t, i) => (
                      <li key={i} className="border-b border-border-strong/50 py-2 text-xs text-ink-2 last:border-0">{t}</li>
                    ))}
                  </ol>
                </details>

                <SafetyGate safety={result.safety} />
              </motion.div>
            )}
          </div>
        </div>
      </PageContainer>
    </>
  )
}
