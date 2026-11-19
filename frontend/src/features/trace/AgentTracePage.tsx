import { Check, PlayCircle, Workflow } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { api } from '../../api/client'
import type { AgentRun } from '../../api/types'
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
  safetyColor,
} from '../../design-system'
import { PageContainer } from '../../layouts/AppShell'
import { usePatients } from '../../PatientContext'
import { SafetyGate } from '../safety/SafetyGate'

/**
 * The backend returns `trace` as a flat `list[str]` — no node ids, edges,
 * per-step durations or statuses. Each line is split on its first colon
 * into the agent name and what it reported. Nothing beyond that is
 * inferred, and no graph topology is drawn, because none is returned.
 */
function splitStep(line: string): { agent: string; detail: string | null } {
  const i = line.indexOf(':')
  return i === -1 ? { agent: line, detail: null } : { agent: line.slice(0, i), detail: line.slice(i + 1).trim() }
}

/** Which optional artifacts a run can produce — shared by the hero metric
    and the "Produced by this run" list below, so the two never disagree. */
const ARTIFACT_KEYS = ['screening', 'evidence', 'simulation', 'care_plan', 'chat'] as const satisfies readonly (keyof AgentRun)[]

export function AgentTracePage() {
  const { selected } = usePatients()
  const [run, setRun] = useState<AgentRun | null>(null)
  const [mode, setMode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reduced = useReducedMotion()

  const runPipeline = async (m: string) => {
    if (!selected) return
    setBusy(true)
    setMode(m)
    setError(null)
    try {
      setRun(await api.runPipeline(selected.id, m))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const producedCount = run ? ARTIFACT_KEYS.filter((k) => run[k] != null).length : 0

  return (
    <>
      <section className="border-b border-border-strong">
        <PageContainer className="py-12 lg:py-16">
          <StageHeader
            eyebrow="System · Agent execution"
            eyebrowIcon={Workflow}
            title="Agent Trace"
            subtitle="Which agents ran, in what order, for one request — and how the safety gate judged the output. Every step shown is a line the backend actually returned; none are inferred."
            actions={
              selected ? (
                <>
                  <Button variant="primary" onClick={() => runPipeline('intake')} disabled={busy}>
                    <PlayCircle size={15} /> Run intake pipeline
                  </Button>
                  <Button variant="secondary" onClick={() => runPipeline('simulation')} disabled={busy}>
                    Run simulation route
                  </Button>
                  <Chip tone="outline">
                    #{selected.id} {selected.pseudonym}
                  </Chip>
                </>
              ) : (
                <Chip tone="teal">Choose a patient from the chip in the top bar</Chip>
              )
            }
            /* Populated only once a run exists — before that there is no
               execution to summarize. */
            metrics={
              run ? (
                <>
                  <Stat label="Steps executed" emphasis="key" value={<CountUp value={run.trace.length} />} />
                  <Stat label="Route" value={<span className="font-mono text-sm">{run.mode}</span>} />
                  <Stat
                    label="Artifacts produced"
                    value={<CountUp value={producedCount} />}
                    hint={`of ${ARTIFACT_KEYS.length} possible`}
                  />
                  <Stat
                    label="Safety gate"
                    value={<span style={{ color: safetyColor[run.safety.status] }}>{run.safety.status.replace(/_/g, ' ')}</span>}
                  />
                </>
              ) : undefined
            }
          />
        </PageContainer>
      </section>

      <PageContainer className="py-10 lg:py-12">
        <ErrorState error={error} onRetry={() => mode && runPipeline(mode)} />

        {busy && (
          <div role="status" aria-label="Running pipeline" className="max-w-2xl space-y-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-full max-w-md" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!busy && !run && (
          <EmptyState
            icon={PlayCircle}
            title="No pipeline run yet"
            reason={
              selected
                ? 'Run the intake or simulation route above to capture a real agent execution trace.'
                : 'Select a patient, then run a pipeline to capture an execution trace.'
            }
          />
        )}

        {run && !busy && (
          <div className="grid gap-8 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <CardLabel>Execution timeline · mode “{run.mode}”</CardLabel>
              <Card layer="data" pad="lg">
                <ol className="relative">
                  {run.trace.map((line, i) => {
                    const { agent, detail } = splitStep(line)
                    const last = i === run.trace.length - 1
                    return (
                      <motion.li
                        key={i}
                        className="flex gap-4 pb-6 last:pb-0"
                        initial={reduced ? false : { opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: reduced ? 0 : i * 0.07, duration: 0.3 }}
                      >
                        <span className="flex shrink-0 flex-col items-center">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-teal/40 bg-teal/12 text-teal">
                            <Check size={13} strokeWidth={3} />
                          </span>
                          {!last && <span className="mt-1.5 w-px flex-1 bg-gradient-to-b from-border-strong to-transparent" />}
                        </span>
                        <span className="min-w-0 pb-1">
                          <span className="block text-sm font-semibold text-ink">{agent}</span>
                          {detail && <span className="mt-1 block text-sm leading-relaxed text-ink-2">{detail}</span>}
                        </span>
                      </motion.li>
                    )
                  })}
                </ol>
                <p className="mt-4 border-t border-border-strong pt-4 text-[0.68rem] leading-relaxed text-ink-3">
                  Step order is exactly as returned. The API does not report per-step duration or status, so none is
                  shown.
                </p>
              </Card>
            </div>

            <div className="lg:col-span-5">
              <CardLabel>Produced by this run</CardLabel>
              <Card layer="data" pad="md" className="mb-6">
                <ul className="divide-y divide-border-strong text-sm">
                  {([
                    ['Screening', run.screening],
                    ['Evidence', run.evidence],
                    ['Simulation', run.simulation],
                    ['Care plan', run.care_plan],
                    ['Chat', run.chat],
                  ] as const).map(([label, value]) => (
                    <li key={label} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className="text-ink-2">{label}</span>
                      {value ? (
                        <Chip tone="teal">produced</Chip>
                      ) : (
                        <span className="text-xs text-ink-3">not part of this route</span>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>

              <SafetyGate safety={run.safety} />
            </div>
          </div>
        )}
      </PageContainer>
    </>
  )
}
