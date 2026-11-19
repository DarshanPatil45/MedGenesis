import * as Dialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Sparkles, X } from 'lucide-react'
import { api } from '../../api/client'
import type { Patient, TimelineEvent } from '../../api/types'
import { Button, SAFETY_DISCLAIMER } from '../../design-system'
import {
  CARDIOMETABOLIC,
  EDUCATION_OPTIONS,
  EMPTY_FORM,
  FUNCTIONAL_YESNO,
  GEN_HLTH_OPTIONS,
  HEALTHCARE,
  INCOME_OPTIONS,
  LIFESTYLE,
  MODEL_FEATURE_COUNT,
  SEX_OPTIONS,
  STEP_DEFS,
  buildMeasurementDelta,
  buildMeasurementDiff,
  buildPayload,
  formFromState,
  formatFieldValue,
  identityStepErrors,
  type FormState,
  type MeasurementChange,
  type YesNoKey,
} from './intakeSchema'
import {
  DaysField,
  LockedField,
  ModelRequiredBadge,
  NumberField,
  ScaleCardField,
  SexField,
  TextField,
  WorkspaceOnlyBadge,
  YesNoField,
  YesNoGroup,
} from './IntakeFields'
import { ActivityFrequencyField, AlcoholFrequencyField, HeightWeightBmiField, ServingsField, SmokingStatusField } from './DerivedFields'

type Mode = 'create' | 'edit'

/**
 * Identity step, its own component (not a switch case) because its
 * height/weight-derived BMI needs local state a switch branch can't hold
 * (React hooks can't be called conditionally). Height and weight
 * themselves are never persisted as FormState — they're an entry aid that
 * computes `form.bmi` live via the exact formula in clinicalModel.ts, so
 * buildMeasurements/buildPayload never change.
 */
function IdentityStepContent({
  mode,
  form,
  set,
  errors,
}: {
  mode: Mode
  form: FormState
  set: (patch: Partial<FormState>) => void
  errors: string[]
}) {
  const [heightCm, setHeightCm] = useState('')
  const [weightKg, setWeightKg] = useState('')

  return (
    <div className="max-w-2xl space-y-7">
      <div>
        <div className="mb-2">
          <WorkspaceOnlyBadge />
        </div>
        {mode === 'edit' ? (
          <LockedField
            label="Pseudonym"
            value={form.pseudonym}
            reason="MedGenesis has no patient-record update endpoint, so renaming happens outside this flow — only the baseline measurements below can be edited here."
          />
        ) : (
          <TextField
            label="Pseudonym"
            value={form.pseudonym}
            onChange={(v) => set({ pseudonym: v })}
            placeholder="e.g. Participant 004"
            hint="How this synthetic patient is labelled across the workspace. Leave blank to store as “Unnamed patient”. No real identifying information is stored."
            autoFocus
          />
        )}
      </div>

      <div>
        <div className="mb-3">
          <ModelRequiredBadge />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {mode === 'edit' ? (
            <>
              <LockedField
                label="Age"
                value={`${form.age} years`}
                reason="Stored on the patient record — same constraint as Pseudonym."
              />
              <LockedField
                label="Sex"
                value={form.sex}
                reason="Stored on the patient record — same constraint as Pseudonym."
              />
            </>
          ) : (
            <>
              <NumberField
                label="Age"
                value={form.age}
                onChange={(v) => set({ age: v })}
                min={0}
                max={120}
                step={1}
                unit="years"
                invalid={errors.some((e) => e.startsWith('Age'))}
                hint="Converted server-side into the model's 13-band BRFSS age bucket."
              />
              <SexField value={form.sex} onChange={(v) => set({ sex: v })} options={SEX_OPTIONS} />
            </>
          )}
          <NumberField
            label="BMI"
            value={form.bmi}
            onChange={(v) => set({ bmi: v })}
            min={1}
            max={100}
            unit="kg/m²"
            invalid={errors.some((e) => e.startsWith('BMI'))}
            hint="Body-mass index. Required — the model has no default to fall back on."
          />
        </div>
        <div className="mt-4 max-w-sm">
          <HeightWeightBmiField
            heightCm={heightCm}
            weightKg={weightKg}
            bmi={form.bmi}
            onHeightChange={setHeightCm}
            onWeightChange={setWeightKg}
            onBmiChange={(v) => set({ bmi: v })}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Lifestyle step, its own component for the same reason as Identity:
 * each richer-entry field (activity frequency, servings/day, drinks/week,
 * smoking status) needs local state a switch branch can't hold. The
 * plain Yes/No toggles stay fully visible and directly editable — the
 * richer inputs are an alternative way to arrive at the same value, never
 * a replacement that hides the underlying Yes/No.
 */
function LifestyleStepContent({
  form,
  setYesNo,
}: {
  form: FormState
  setYesNo: (key: YesNoKey, v: boolean) => void
}) {
  const activity = LIFESTYLE.find((d) => d.key === 'phys_activity')!
  const fruits = LIFESTYLE.find((d) => d.key === 'fruits')!
  const veggies = LIFESTYLE.find((d) => d.key === 'veggies')!
  const smoker = LIFESTYLE.find((d) => d.key === 'smoker')!
  const alcohol = LIFESTYLE.find((d) => d.key === 'hvy_alcohol_consump')!

  return (
    <div className="max-w-2xl space-y-4">
      <div className="mb-4">
        <ModelRequiredBadge />
      </div>

      <div className="data-surface rounded-[14px] px-4">
        <YesNoField def={activity} value={form.phys_activity} onChange={(v) => setYesNo('phys_activity', v)} />
      </div>
      <ActivityFrequencyField value={form.phys_activity} onChange={(v) => setYesNo('phys_activity', v)} />

      <div className="data-surface rounded-[14px] px-4">
        <YesNoField def={fruits} value={form.fruits} onChange={(v) => setYesNo('fruits', v)} />
      </div>
      <ServingsField label="Fruit" value={form.fruits} onChange={(v) => setYesNo('fruits', v)} />

      <div className="data-surface rounded-[14px] px-4">
        <YesNoField def={veggies} value={form.veggies} onChange={(v) => setYesNo('veggies', v)} />
      </div>
      <ServingsField label="Vegetable" value={form.veggies} onChange={(v) => setYesNo('veggies', v)} />

      <div className="data-surface rounded-[14px] px-4">
        <YesNoField def={smoker} value={form.smoker} onChange={(v) => setYesNo('smoker', v)} />
      </div>
      <SmokingStatusField onChange={(v) => setYesNo('smoker', v)} />

      <div className="data-surface rounded-[14px] px-4">
        <YesNoField def={alcohol} value={form.hvy_alcohol_consump} onChange={(v) => setYesNo('hvy_alcohol_consump', v)} />
      </div>
      <AlcoholFrequencyField sex={form.sex} value={form.hvy_alcohol_consump} onChange={(v) => setYesNo('hvy_alcohol_consump', v)} />
    </div>
  )
}

/** One step's field content. Kept as a single switch, not per-step files —
    every step but Identity/Lifestyle/Sociodemographic/Review is a
    homogeneous Yes/No group, so splitting further would scatter one idea
    across many near-empty files. Identity and Lifestyle are their own
    components above (not switch cases) because they hold local state for
    their richer, derivation-based inputs. */
function StepContent({
  step,
  mode,
  form,
  set,
  setYesNo,
  errors,
}: {
  step: (typeof STEP_DEFS)[number]
  mode: Mode
  form: FormState
  set: (patch: Partial<FormState>) => void
  setYesNo: (key: YesNoKey, v: boolean) => void
  errors: string[]
}) {
  switch (step.id) {
    case 'identity':
      return <IdentityStepContent mode={mode} form={form} set={set} errors={errors} />

    case 'cardiometabolic':
      return (
        <div className="max-w-2xl">
          <div className="mb-4">
            <ModelRequiredBadge />
          </div>
          <YesNoGroup defs={CARDIOMETABOLIC} form={form} onChange={setYesNo} />
        </div>
      )

    case 'functional':
      return (
        <div className="max-w-2xl space-y-7">
          <div className="mb-4">
            <ModelRequiredBadge />
          </div>
          <YesNoGroup defs={FUNCTIONAL_YESNO} form={form} onChange={setYesNo} />
          <ScaleCardField
            label="Self-rated general health"
            hint="How the patient rates their own overall health"
            options={GEN_HLTH_OPTIONS}
            value={form.gen_hlth}
            onChange={(v) => set({ gen_hlth: v })}
          />
          <DaysField
            id="phys_hlth"
            label="Poor physical-health days"
            hint="Days of poor physical health, including injury, in the last 30 days"
            value={Number(form.phys_hlth)}
            onChange={(v) => set({ phys_hlth: String(v) })}
          />
          <DaysField
            id="ment_hlth"
            label="Poor mental-health days"
            hint="Days of poor mental health, including stress and depression, in the last 30 days"
            value={Number(form.ment_hlth)}
            onChange={(v) => set({ ment_hlth: String(v) })}
          />
        </div>
      )

    case 'lifestyle':
      return <LifestyleStepContent form={form} setYesNo={setYesNo} />

    case 'healthcare':
      return (
        <div className="max-w-2xl">
          <div className="mb-4">
            <ModelRequiredBadge />
          </div>
          <YesNoGroup defs={HEALTHCARE} form={form} onChange={setYesNo} />
        </div>
      )

    case 'sociodemographic':
      return (
        <div className="max-w-2xl space-y-7">
          <div className="mb-1 flex items-center gap-2">
            <ModelRequiredBadge />
          </div>
          <p className="-mt-4 text-xs leading-relaxed text-ink-3">
            These fields are part of the BRFSS feature set used by the screening model. They shape the
            statistical baseline only — neither education nor income diagnoses diabetes, and the model does
            not receive or infer anything beyond the exact value selected here.
          </p>
          <ScaleCardField
            label="Education level"
            options={EDUCATION_OPTIONS}
            value={form.education}
            onChange={(v) => set({ education: v })}
          />
          <ScaleCardField
            label="Household income"
            options={INCOME_OPTIONS}
            value={form.income}
            onChange={(v) => set({ income: v })}
          />
        </div>
      )

    default:
      return null
  }
}

function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 text-sm last:border-b-0">
      <span className="text-ink-2">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  )
}

function ReviewSection({ title, badge, children }: { title: string; badge: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="data-surface rounded-[14px] p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[0.66rem] font-bold tracking-[0.14em] text-ink-3 uppercase">{title}</p>
        {badge}
      </div>
      {children}
    </div>
  )
}

/**
 * The confirmation surface the brief asked for: "display a compact review
 * ... ask for confirmation" before a save actually writes anything. Only
 * changed or newly-recorded fields appear — matching the requested
 * "BMI: 28.4 → 30.1" format — and the Save action is disabled while this
 * is empty, so an edit session with no real changes can't write a no-op
 * event.
 */
function ChangesSummary({ changes }: { changes: MeasurementChange[] }) {
  if (changes.length === 0) {
    return (
      <div className="data-surface mb-6 rounded-[14px] p-4 text-sm text-ink-3">
        No changes yet — adjust a field on an earlier step to see it summarized here before saving.
      </div>
    )
  }
  return (
    <div className="mb-6 overflow-hidden rounded-[14px] border border-amber/30 bg-amber/6">
      <p className="border-b border-amber/20 px-4 py-2.5 text-[0.64rem] font-bold tracking-[0.14em] text-amber uppercase">
        Changes to baseline · {changes.length}
      </p>
      <div className="divide-y divide-amber/15 px-4">
        {changes.map((c) => (
          <div key={c.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
            <span className="text-ink-2">
              {c.label}
              {c.isNew && <span className="ml-1.5 text-[0.62rem] text-ink-3">(newly recorded)</span>}
            </span>
            <span className="flex items-center gap-2 font-medium">
              <span className="text-ink-3 line-through">{c.from}</span>
              <ArrowRight size={12} className="shrink-0 text-ink-3" aria-hidden="true" />
              <span className="text-teal">{c.to}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReviewStep({ form, mode, changes }: { form: FormState; mode: Mode; changes: MeasurementChange[] }) {
  return (
    <div className="max-w-3xl">
      <p className="mb-5 text-sm leading-relaxed text-ink-2">
        {mode === 'edit' ? (
          <>
            Saving writes one new baseline measurement event to this patient's append-only timeline — every
            prior value stays on the timeline; nothing is overwritten or deleted.
          </>
        ) : (
          <>
            Creating the profile writes one baseline measurement event to this patient's append-only timeline.
            Every field below is one of the model's {MODEL_FEATURE_COUNT} trained features — except Pseudonym,
            which is a workspace label only.
          </>
        )}
      </p>

      {mode === 'edit' && <ChangesSummary changes={changes} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ReviewSection title="Identity" badge={<WorkspaceOnlyBadge />}>
          <ReviewRow label="Pseudonym" value={form.pseudonym.trim() || 'Unnamed patient'} />
        </ReviewSection>

        <ReviewSection title="Baseline" badge={<ModelRequiredBadge />}>
          <ReviewRow label="Age" value={`${form.age} yrs`} />
          <ReviewRow label="Sex" value={form.sex} />
          <ReviewRow label="BMI" value={form.bmi || '—'} />
        </ReviewSection>

        <ReviewSection title="Cardiometabolic history" badge={<ModelRequiredBadge />}>
          {CARDIOMETABOLIC.map((d) => (
            <ReviewRow key={d.key} label={d.label} value={formatFieldValue(d.key, form[d.key] ? 1 : 0)} />
          ))}
        </ReviewSection>

        <ReviewSection title="Functional health" badge={<ModelRequiredBadge />}>
          {FUNCTIONAL_YESNO.map((d) => (
            <ReviewRow key={d.key} label={d.label} value={formatFieldValue(d.key, form[d.key] ? 1 : 0)} />
          ))}
          <ReviewRow label="General health" value={formatFieldValue('gen_hlth', form.gen_hlth)} />
          <ReviewRow label="Poor physical-health days" value={formatFieldValue('phys_hlth', form.phys_hlth)} />
          <ReviewRow label="Poor mental-health days" value={formatFieldValue('ment_hlth', form.ment_hlth)} />
        </ReviewSection>

        <ReviewSection title="Lifestyle" badge={<ModelRequiredBadge />}>
          {LIFESTYLE.map((d) => (
            <ReviewRow key={d.key} label={d.label} value={formatFieldValue(d.key, form[d.key] ? 1 : 0)} />
          ))}
        </ReviewSection>

        <ReviewSection title="Healthcare access" badge={<ModelRequiredBadge />}>
          {HEALTHCARE.map((d) => (
            <ReviewRow key={d.key} label={d.label} value={formatFieldValue(d.key, form[d.key] ? 1 : 0)} />
          ))}
        </ReviewSection>

        <ReviewSection title="Sociodemographic context" badge={<ModelRequiredBadge />}>
          <ReviewRow label="Education" value={formatFieldValue('education', form.education)} />
          <ReviewRow label="Household income" value={formatFieldValue('income', form.income)} />
        </ReviewSection>
      </div>
    </div>
  )
}

type IntakeWizardProps =
  | {
      mode?: 'create'
      open: boolean
      onOpenChange: (open: boolean) => void
      onCreated: (patient: Patient) => Promise<void> | void
    }
  | {
      mode: 'edit'
      open: boolean
      onOpenChange: (open: boolean) => void
      /** The patient being edited — supplies the locked identity fields. */
      patient: Patient
      /** `Timeline.current_state` — the materialized fold this edit diffs
          against and pre-populates from. */
      currentState: Record<string, unknown>
      onSaved: (event: TimelineEvent) => Promise<void> | void
    }

/**
 * Full-screen intake workstation — one component for both creating a
 * patient and editing an existing one. Deliberately a bespoke Radix Dialog
 * rather than the shared `Drawer`: `Drawer` caps out at max-w-2xl as a
 * right-side panel, too narrow for a step rail plus dense per-section
 * content side by side.
 *
 * Edit mode never overwrites anything: `submit()` posts only the changed
 * keys as a new `measurement` event via the existing
 * `POST /api/twin/{id}/events` (no backend change), so the prior values
 * stay exactly where they were written — the append-only log this app was
 * already built on.
 */
export function IntakeWizard(props: IntakeWizardProps) {
  const { open, onOpenChange } = props
  const mode: Mode = props.mode === 'edit' ? 'edit' : 'create'

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  // The raw pre-edit state, captured once per open — `buildMeasurementDiff`
  // compares against this, never against `form` itself, so a value that's
  // merely been re-selected back to its original setting doesn't linger in
  // the diff, and a field the wizard had to default (never actually on
  // file) is never reported as "changed" from a fabricated prior value.
  const [initialState, setInitialState] = useState<Record<string, unknown> | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [visited, setVisited] = useState<Set<number>>(new Set([0]))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reduced = useReducedMotion()

  // Fresh form every time the wizard opens — a half-filled/abandoned
  // previous attempt should never reappear, and an edit session always
  // starts from the patient's actual current state, not a stale one from
  // an earlier open.
  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && props.mode === 'edit') {
      setForm(formFromState(props.currentState, props.patient))
      setInitialState(props.currentState)
    } else {
      setForm(EMPTY_FORM)
      setInitialState(null)
    }
    setStepIndex(0)
    setVisited(new Set([0]))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const step = STEP_DEFS[stepIndex]
  const isReview = step.id === 'review'
  const errors = stepIndex === 0 ? identityStepErrors(form) : []
  const changes = mode === 'edit' && initialState ? buildMeasurementDiff(form, initialState) : []
  const stepLabel = step.id === 'review' ? (mode === 'edit' ? 'Review & Save' : 'Review & Create') : step.label

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))
  const setYesNo = (key: YesNoKey, v: boolean) => setForm((f) => ({ ...f, [key]: v }))

  const goNext = () => {
    if (errors.length > 0) return
    const next = Math.min(stepIndex + 1, STEP_DEFS.length - 1)
    setStepIndex(next)
    setVisited((v) => new Set(v).add(next))
  }
  const goBack = () => setStepIndex((i) => Math.max(0, i - 1))
  const jumpTo = (i: number) => {
    if (visited.has(i)) setStepIndex(i)
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'edit' && props.mode === 'edit') {
        if (changes.length === 0) return
        const event = await api.appendEvent(props.patient.id, {
          event_type: 'measurement',
          payload: buildMeasurementDelta(changes, form),
        })
        await props.onSaved(event)
      } else if (props.mode !== 'edit') {
        const patient = await api.createPatient(buildPayload(form))
        await props.onCreated(patient)
      }
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const saveDisabled = busy || (mode === 'edit' && changes.length === 0)

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#0b1220]/45 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-[18px] border border-border-strong bg-page shadow-2xl outline-none sm:inset-6 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-[0.98] data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-[0.98] duration-200"
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-strong bg-surface px-5 py-3.5 sm:px-7">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-lg font-semibold text-ink">
                {mode === 'edit' ? 'Edit patient baseline' : 'New patient baseline'}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-ink-3">
                Step {stepIndex + 1} of {STEP_DEFS.length} — {stepLabel}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              disabled={busy}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-border-strong text-ink-2 transition-colors hover:bg-subtle hover:text-ink disabled:opacity-40"
            >
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-1">
            {/* Step rail */}
            <nav
              aria-label="Intake steps"
              className="hidden w-64 shrink-0 overflow-y-auto border-r border-border-strong bg-surface/60 p-3 lg:block"
            >
              {STEP_DEFS.map((s, i) => {
                const done = visited.has(i) && i < stepIndex
                const current = i === stepIndex
                const reachable = visited.has(i)
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => jumpTo(i)}
                    disabled={!reachable}
                    className={`mb-1 flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                      current ? 'bg-teal/10' : reachable ? 'hover:bg-subtle' : 'cursor-not-allowed opacity-50'
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.66rem] font-bold ${
                        current
                          ? 'bg-teal text-white'
                          : done
                            ? 'border border-teal/50 bg-teal/10 text-teal'
                            : 'border border-border-strong bg-surface text-ink-3'
                      }`}
                    >
                      {done ? <Check size={12} strokeWidth={3} /> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={`block truncate text-sm font-medium ${current ? 'text-teal' : 'text-ink-2'}`}>
                        {s.id === 'review' ? (mode === 'edit' ? 'Review' : s.short) : s.short}
                      </span>
                    </span>
                  </button>
                )
              })}
            </nav>

            {/* Content */}
            {/* tabIndex + aria-label: axe's scrollable-region-focusable —
                without it, keyboard users (Safari especially) cannot
                scroll this pane once it overflows on the denser steps. */}
            <div
              tabIndex={0}
              aria-label={`${stepLabel} content`}
              className="min-h-0 flex-1 overflow-y-auto px-5 py-6 outline-none sm:px-8 sm:py-8"
            >
              <p className="mb-1 text-[0.64rem] font-bold tracking-[0.16em] text-teal uppercase">{stepLabel}</p>
              <p className="mb-6 max-w-2xl text-sm leading-relaxed text-ink-2">{step.description}</p>

              {error && (
                <div role="alert" className="mb-5 max-w-2xl rounded-[10px] border border-rose/40 bg-rose/10 px-4 py-3 text-sm text-ink">
                  {error}
                </div>
              )}

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step.id}
                  initial={reduced ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? undefined : { opacity: 0, y: -6 }}
                  transition={{ duration: 0.16 }}
                >
                  {isReview ? (
                    <ReviewStep form={form} mode={mode} changes={changes} />
                  ) : (
                    <StepContent step={step} mode={mode} form={form} set={set} setYesNo={setYesNo} errors={errors} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-border-strong bg-surface px-5 py-3.5 sm:px-7">
            <div className="flex items-center justify-between gap-4">
              <Button variant="ghost" size="sm" onClick={goBack} disabled={stepIndex === 0 || busy}>
                <ArrowLeft size={14} /> Back
              </Button>

              {/* mobile progress dots */}
              <div className="flex items-center gap-1.5 lg:hidden" role="group" aria-label={`Step ${stepIndex + 1} of ${STEP_DEFS.length}`}>
                {STEP_DEFS.map((s, i) => (
                  <span
                    key={s.id}
                    aria-current={i === stepIndex ? 'step' : undefined}
                    className={`h-1.5 rounded-full transition-all duration-200 ${
                      i === stepIndex ? 'w-5 bg-teal' : i < stepIndex ? 'w-1.5 bg-teal/50' : 'w-1.5 bg-border-strong'
                    }`}
                  />
                ))}
              </div>

              {!isReview ? (
                <Button variant="primary" size="sm" onClick={goNext} disabled={errors.length > 0 || busy}>
                  Continue <ArrowRight size={14} />
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={() => void submit()} disabled={saveDisabled}>
                  <Sparkles size={14} />
                  {busy
                    ? mode === 'edit'
                      ? 'Saving…'
                      : 'Creating…'
                    : mode === 'edit'
                      ? 'Save changes'
                      : 'Create Digital Twin'}
                </Button>
              )}
            </div>
            {stepIndex === 0 && errors.length > 0 && (
              <p className="mt-2 text-xs text-rose">{errors.join(' ')}</p>
            )}
            <p className="mt-2.5 text-[0.64rem] leading-relaxed text-ink-3">{SAFETY_DISCLAIMER}</p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
