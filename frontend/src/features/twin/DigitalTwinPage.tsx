import { ChevronDown, ShieldCheck, UserRound, Waypoints, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { DigitalTwin, Timeline, TimelineEvent } from '../../api/types'
import {
  Card,
  CardLabel,
  ChartSkeleton,
  Chip,
  ChipButton,
  Drawer,
  EmptyState,
  ErrorState,
  Skeleton,
  StageHeader,
  color,
  eventColor,
} from '../../design-system'
import { PageContainer } from '../../layouts/AppShell'
import { usePatients } from '../../PatientContext'
import { IntakeWizard } from '../intake/IntakeWizard'
import { buildFeatureMapping } from './clinicalModel'
import { CurrentHealthSection } from './CurrentHealthSection'
import { DiabetesDrawer } from './DiabetesDrawer'
import { isStructuredDiabetesNote } from './diabetesModel'
import { LongitudinalTimeline } from './LongitudinalTimeline'
import { MedicationDrawer } from './MedicationDrawer'
import { ModelFeatureMappingPanel } from './ModelFeatureMappingPanel'
import { NoteDrawer } from './NoteDrawer'
import { PatientHeader } from './PatientHeader'
import { RecordEventDrawer } from './RecordEventDrawer'
import { LANE_LABEL, TimelineCanvas } from './TimelineCanvas'
import { TrendsSection } from './TrendsSection'
import { VitalsLabsDrawer } from './VitalsLabsDrawer'

/** Events that materialize into `current_state` — mirrors the backend's
    own STATE_EVENT_TYPES (app/services/twin.py), used here only to find
    the most recent one for the "Updated <date>" indicator. */
const STATE_EVENT_TYPES = new Set(['measurement', 'lifestyle_log'])

function humanize(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/** Filter chips are derived from the event types this patient actually has. */
const FILTER_ORDER = ['lab_result', 'medication_change', 'measurement', 'lifestyle_log', 'screening', 'care_plan', 'note']

export function DigitalTwinPage() {
  const { selected } = usePatients()
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [twin, setTwin] = useState<DigitalTwin | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<string[]>([])
  const [record, setRecord] = useState<TimelineEvent | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [recordEventOpen, setRecordEventOpen] = useState(false)
  const [vitalsOpen, setVitalsOpen] = useState(false)
  const [medicationOpen, setMedicationOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [diabetesOpen, setDiabetesOpen] = useState(false)
  const [justSaved, setJustSaved] = useState<{ event: TimelineEvent; label: string; fieldCount: number | null } | null>(null)

  const load = useCallback(async (patientId: number) => {
    setLoading(true)
    setError(null)
    try {
      // Two independent reads of the same patient: `timeline` is the flat
      // event log plus the materialized fold every agent scores against;
      // `digitalTwin` is the pre-grouped labs/medications view
      // (GET /api/twin/{id}/digital-twin) — additive, doesn't change what
      // `timeline` returns, per that endpoint's own docstring.
      const [tl, dt] = await Promise.all([api.timeline(patientId), api.digitalTwin(patientId)])
      setTimeline(tl)
      setTwin(dt)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setJustSaved(null)
    if (selected) void load(selected.id)
  }, [selected, load])

  const events = useMemo(() => timeline?.events ?? [], [timeline])

  const availableTypes = useMemo(
    () => FILTER_ORDER.filter((t) => events.some((e) => e.event_type === t)),
    [events],
  )

  const shown = active.length === 0 ? events : events.filter((e) => active.includes(e.event_type))
  // Structured Diabetes & Blood Sugar entries (status/symptoms) also use
  // the `note` event type — see diabetesModel.ts — but render in their
  // own dedicated group, not the free-text Symptoms list.
  const notes = useMemo(
    () => events.filter((e) => e.event_type === 'note' && !isStructuredDiabetesNote(e)),
    [events],
  )
  const featureMapping = useMemo(() => buildFeatureMapping(timeline?.current_state), [timeline])

  /** Most recent event that actually feeds `current_state` — the real
      "when was the record last touched" answer, not a guess. */
  const lastUpdatedAt = useMemo(() => {
    const stateEvents = events.filter((e) => STATE_EVENT_TYPES.has(e.event_type))
    if (!stateEvents.length) return null
    return stateEvents.reduce((latest, e) =>
      new Date(e.recorded_at).getTime() > new Date(latest).getTime() ? e.recorded_at : latest,
      stateEvents[0].recorded_at,
    )
  }, [events])

  const stateEntries = Object.entries(timeline?.current_state ?? {})
  const dateRange = useMemo(() => {
    if (!events.length) return null
    const t = events.map((e) => new Date(e.recorded_at).getTime())
    return { from: new Date(Math.min(...t)), to: new Date(Math.max(...t)) }
  }, [events])

  if (!selected) {
    return (
      <PageContainer className="py-16">
        <EmptyState
          icon={UserRound}
          title="No patient selected"
          reason="The Digital Twin is built from one patient's append-only event log."
          action={<Chip tone="teal">Choose a patient from the chip in the top bar</Chip>}
        />
      </PageContainer>
    )
  }

  return (
    <>
      {/* Minimal — this page is the identity anchor now (PatientHeader,
          just below), not a separate editorial hero repeating the same
          information the header already states more directly. */}
      <section className="border-b border-border-strong">
        <PageContainer className="py-8">
          <StageHeader eyebrow="Digital Twin" eyebrowIcon={Waypoints} title="Patient record" />
        </PageContainer>
      </section>

      <PageContainer className="py-10 lg:py-12">
        <ErrorState error={error} onRetry={() => selected && load(selected.id)} />

        {justSaved && (
          <div className="mb-8 flex items-center justify-between gap-4 rounded-[14px] border border-teal/30 bg-teal/8 px-5 py-3.5">
            <p className="flex items-center gap-2 text-sm text-ink">
              <ShieldCheck size={16} className="shrink-0 text-teal" />
              <span>
                {/* Visible source, not a mysterious change: the label is
                    set explicitly by whichever action just completed
                    (see the onSaved callbacks below) rather than guessed
                    from event_type, which is ambiguous — Edit Patient
                    Baseline and a Vitals & Labs BMI derivation both write
                    `event_type: "measurement"`. */}
                <strong className="font-semibold">{justSaved.label}</strong>
                {justSaved.fieldCount !== null && (
                  <>
                    {' '}
                    — {justSaved.fieldCount} field{justSaved.fieldCount === 1 ? '' : 's'}
                  </>
                )}{' '}
                · {new Date(justSaved.event.recorded_at).toLocaleString()}
              </span>
            </p>
            <button
              type="button"
              onClick={() => setJustSaved(null)}
              aria-label="Dismiss"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-subtle hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <PatientHeader
          patient={selected}
          lastUpdatedAt={lastUpdatedAt}
          onEdit={() => setEditOpen(true)}
          onRecordEvent={() => setRecordEventOpen(true)}
        />

        {loading && !timeline ? (
          <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : (
          <CurrentHealthSection
            currentState={timeline?.current_state ?? {}}
            twin={twin}
            notes={notes}
            events={events}
            onRecordVitals={() => setVitalsOpen(true)}
            onRecordMedication={() => setMedicationOpen(true)}
            onAddNote={() => setNoteOpen(true)}
            onRecordDiabetesInfo={() => setDiabetesOpen(true)}
          />
        )}

        {!loading && <TrendsSection events={events} />}

        {!loading && <LongitudinalTimeline events={events} />}

        {/* Advanced — the technical/model-facing view of the same data.
            Collapsed by default: this is where "21 required features",
            the raw event fold, and the scatter-plot canvas live, kept
            for anyone auditing the model or debugging, not competing
            with the patient-first sections above for attention. */}
        <details className="data-surface rounded-[14px]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-semibold text-ink">
            Advanced
            <ChevronDown size={15} className="text-ink-3" />
          </summary>
          <div className="border-t border-border-strong p-5">
            {timeline && <ModelFeatureMappingPanel rows={featureMapping} />}

            <div className="grid gap-8 lg:grid-cols-12">
              {/* Canvas — 8 cols */}
              <div className="lg:col-span-8">
                <CardLabel>Longitudinal canvas</CardLabel>
                {loading && !timeline ? (
                  <ChartSkeleton className="h-[26rem]" />
                ) : events.length === 0 ? (
                  <EmptyState
                    icon={Waypoints}
                    title="No events recorded"
                    reason="This patient has no timeline events yet. Load a seeded scenario on Patient Intake to populate one."
                  />
                ) : (
                  <Card layer="data" pad="sm">
                    <TimelineCanvas events={shown} onSelect={setRecord} />
                    <p className="px-2 pb-1 text-[0.68rem] text-ink-3">
                      Drag the brush below the plot to zoom a date range. Click any point to open its full record.
                    </p>
                  </Card>
                )}
              </div>

              {/* Side rail — 4 cols */}
              <aside className="lg:col-span-4">
                <CardLabel>Filters</CardLabel>
                <div className="mb-6 flex flex-wrap gap-2">
                  <ChipButton selected={active.length === 0} onClick={() => setActive([])}>
                    All
                  </ChipButton>
                  {availableTypes.map((t) => (
                    <ChipButton
                      key={t}
                      selected={active.includes(t)}
                      onClick={() =>
                        setActive((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))
                      }
                    >
                      {LANE_LABEL[t] ?? t}
                    </ChipButton>
                  ))}
                </div>

                <CardLabel>Recorded range</CardLabel>
                <Card layer="data" pad="sm" className="mb-6">
                  {loading && !dateRange ? (
                    <Skeleton className="h-10" />
                  ) : dateRange ? (
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-mono text-ink">{dateRange.from.toLocaleDateString()}</span>
                      <span className="h-px flex-1 bg-border-strong" aria-hidden="true" />
                      <span className="font-mono text-ink">{dateRange.to.toLocaleDateString()}</span>
                    </div>
                  ) : (
                    <p className="text-sm text-ink-3">No recorded events.</p>
                  )}
                </Card>

                <CardLabel>Recent activity (raw)</CardLabel>
                <Card layer="data" pad="none" className="overflow-hidden">
                  {loading && events.length === 0 ? (
                    <div className="space-y-2 p-4">
                      {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-8" />
                      ))}
                    </div>
                  ) : shown.length === 0 ? (
                    <p className="p-4 text-sm text-ink-3">No events match the selected filters.</p>
                  ) : (
                    <ul className="max-h-80 divide-y divide-border-strong overflow-y-auto">
                      {[...shown]
                        .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
                        .slice(0, 12)
                        .map((e) => (
                          <li key={e.id}>
                            <button
                              onClick={() => setRecord(e)}
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-subtle"
                            >
                              <span
                                aria-hidden="true"
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{ background: eventColor[e.event_type] ?? color.ink3 }}
                              />
                              <span className="w-14 shrink-0 font-mono text-[0.66rem] text-ink-3">
                                {new Date(e.recorded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-xs text-ink-2">
                                {LANE_LABEL[e.event_type] ?? e.event_type}
                              </span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </Card>
              </aside>
            </div>

            {/* Raw fold — the unformatted dict for anyone who wants to see
                exactly what the fold produced, backend field names
                included. */}
            <details className="data-surface mt-8 rounded-[14px]">
              <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-semibold text-ink">
                Raw materialized state · {stateEntries.length} fields
                <ChevronDown size={15} className="text-ink-3" />
              </summary>
              <div className="border-t border-border-strong px-5 py-4">
                {stateEntries.length === 0 ? (
                  <p className="text-sm text-ink-3">No state recorded.</p>
                ) : (
                  <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 font-mono text-xs sm:grid-cols-[max-content_1fr_max-content_1fr]">
                    {stateEntries.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-ink-3">{k}</dt>
                        <dd className="text-ink-2">{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </details>
          </div>
        </details>
      </PageContainer>

      {/* Contextual record drawer */}
      <Drawer
        open={!!record}
        onOpenChange={(o) => !o && setRecord(null)}
        title={record ? (LANE_LABEL[record.event_type] ?? record.event_type) : ''}
        description={record ? new Date(record.recorded_at).toLocaleString() : undefined}
      >
        {record && (
          <>
            <div className="mb-5 flex flex-wrap gap-2">
              <Chip tone="outline">event #{record.id}</Chip>
              <Chip tone="outline">{record.event_type}</Chip>
              <Chip tone={record.source === 'synthetic' ? 'violet' : 'neutral'}>{record.source}</Chip>
            </div>
            <CardLabel>Recorded payload</CardLabel>
            {Object.keys(record.payload).length === 0 ? (
              <p className="text-sm text-ink-3">This event has an empty payload.</p>
            ) : (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 rounded-[14px] border border-border-strong bg-surface px-4 py-4 text-sm">
                {Object.entries(record.payload).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-mono text-xs text-ink-3">{humanize(k)}</dt>
                    <dd className="font-mono text-xs break-words text-ink">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        )}
      </Drawer>

      {selected && (
        <IntakeWizard
          mode="edit"
          open={editOpen}
          onOpenChange={setEditOpen}
          patient={selected}
          currentState={timeline?.current_state ?? {}}
          onSaved={async (event) => {
            await load(selected.id)
            setJustSaved({ event, label: 'Baseline updated', fieldCount: Object.keys(event.payload).length })
          }}
        />
      )}

      {selected && (
        <RecordEventDrawer
          open={recordEventOpen}
          onOpenChange={setRecordEventOpen}
          patientId={selected.id}
          currentState={timeline?.current_state ?? {}}
          onSaved={async (event) => {
            await load(selected.id)
            setJustSaved({ event, label: 'New event recorded', fieldCount: Object.keys(event.payload).length })
          }}
        />
      )}

      {selected && (
        <VitalsLabsDrawer
          open={vitalsOpen}
          onOpenChange={setVitalsOpen}
          patientId={selected.id}
          sex={selected.sex}
          onSaved={async (event) => {
            await load(selected.id)
            // May be several events (each lab is its own lab_result record,
            // plus a derived BMI/lifestyle measurement) — only the last is
            // available here, so the count is intentionally omitted rather
            // than understating what was actually recorded.
            setJustSaved({ event, label: 'Vitals & labs recorded', fieldCount: null })
          }}
        />
      )}

      {selected && (
        <MedicationDrawer
          open={medicationOpen}
          onOpenChange={setMedicationOpen}
          patientId={selected.id}
          onSaved={async (event) => {
            await load(selected.id)
            setJustSaved({ event, label: 'Medication recorded', fieldCount: null })
          }}
        />
      )}

      {selected && (
        <DiabetesDrawer
          open={diabetesOpen}
          onOpenChange={setDiabetesOpen}
          patientId={selected.id}
          onSaved={async (event) => {
            await load(selected.id)
            setJustSaved({ event, label: 'Diabetes & blood sugar recorded', fieldCount: null })
          }}
        />
      )}

      {selected && (
        <NoteDrawer
          open={noteOpen}
          onOpenChange={setNoteOpen}
          patientId={selected.id}
          onSaved={async (event) => {
            await load(selected.id)
            setJustSaved({ event, label: 'Note added', fieldCount: null })
          }}
        />
      )}
    </>
  )
}
