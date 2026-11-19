import { Droplet, Info } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api/client'
import type { TimelineEvent } from '../../api/types'
import { Button, CardLabel, ChipButton, Drawer, SAFETY_DISCLAIMER } from '../../design-system'
import {
  DIABETES_LAB_REFERENCE,
  DIABETES_LAB_TEST,
  DIABETES_LAB_UNIT,
  DIABETES_STATUS_LABEL,
  DIABETES_STATUS_VALUES,
  DIABETES_SYMPTOMS,
  YES_NO_UNKNOWN_LABEL,
  YES_NO_UNKNOWN_VALUES,
  buildDiabetesStatusPayload,
  buildDiabetesSymptomPayload,
  type DiabetesStatusValue,
  type YesNoUnknown,
} from './diabetesModel'

const todayInput = () => new Date().toISOString().slice(0, 10)

const numberInput =
  'w-full rounded-[10px] border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-teal focus-visible:outline-none'

function LabField({
  testName,
  value,
  onChange,
}: {
  testName: string
  value: string
  onChange: (v: string) => void
}) {
  const ref = DIABETES_LAB_REFERENCE[testName]
  const unit = DIABETES_LAB_UNIT[testName]
  return (
    <div className="mb-5 rounded-[12px] border border-border-strong p-4">
      <label className="block text-sm font-medium text-ink">
        {testName}
        <div className="relative mt-1.5 max-w-[12rem]">
          <input type="number" min={0} step="any" className={numberInput} value={value} onChange={(e) => onChange(e.target.value)} />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-3">{unit}</span>
        </div>
      </label>
      {ref && (
        <div className="mt-3 flex gap-2 border-t border-border-strong pt-3 text-xs leading-relaxed text-ink-3">
          <Info size={13} className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
          <p>
            {ref.description} <span className="text-ink-3/90">{ref.ranges}</span>
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Records Diabetes & Blood Sugar information as real, dated events —
 * reusing the exact same mechanisms VitalsLabsDrawer already established:
 *   - HbA1c / Fasting Glucose / 2-Hour OGTT are `lab_result` events. The
 *     test names for HbA1c and Fasting Glucose are the same literal
 *     strings CurrentHealthSection/TrendsSection/clinical_agent.py
 *     already key off of, so this extends those existing trend series
 *     and existing Clinical Analysis claims rather than forking a new,
 *     disconnected one.
 *   - Diabetes status and the three symptoms are categorical, not
 *     numeric, so they ride on `note` (validated by the backend only as
 *     "some JSON object") with a `kind` discriminator — see
 *     diabetesModel.ts. Nothing here is folded into `current_state` or
 *     read by the screening model.
 *
 * The reference ranges shown next to each lab field are static ADA
 * figures, displayed the same regardless of what's typed — never
 * compared against the entered value to render a "this is in the
 * diabetes range" callout. Recording a value here is data entry, not a
 * diagnosis.
 */
export function DiabetesDrawer({
  open,
  onOpenChange,
  patientId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: number
  onSaved: (event: TimelineEvent) => Promise<void> | void
}) {
  const [hba1c, setHba1c] = useState('')
  const [fastingGlucose, setFastingGlucose] = useState('')
  const [ogtt, setOgtt] = useState('')
  const [date, setDate] = useState(todayInput())

  const [status, setStatus] = useState<DiabetesStatusValue | ''>('')
  const [symptoms, setSymptoms] = useState<Record<string, YesNoUnknown | ''>>({})

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasAny = Boolean(hba1c || fastingGlucose || ogtt || status || Object.values(symptoms).some(Boolean))

  const reset = () => {
    setHba1c(''); setFastingGlucose(''); setOgtt(''); setDate(todayInput())
    setStatus(''); setSymptoms({})
    setError(null)
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    // Same reasoning as VitalsLabsDrawer: only backdate when the date
    // picker was actually changed from today, so a "record now" entry
    // keeps a real clock time instead of sorting before same-day events.
    const backdated = date !== todayInput()
    const recordedAt = backdated ? new Date(date).toISOString() : undefined
    try {
      let lastEvent: TimelineEvent | null = null
      const record = async (event_type: string, payload: Record<string, unknown>) => {
        lastEvent = await api.appendEvent(patientId, { event_type, payload, ...(recordedAt ? { recorded_at: recordedAt } : {}) })
      }
      const lab = (test_name: string, value: number) => record('lab_result', { test_name, value, unit: DIABETES_LAB_UNIT[test_name] })

      if (hba1c) await lab(DIABETES_LAB_TEST.HBA1C, Number(hba1c))
      if (fastingGlucose) await lab(DIABETES_LAB_TEST.FASTING_GLUCOSE, Number(fastingGlucose))
      if (ogtt) await lab(DIABETES_LAB_TEST.OGTT, Number(ogtt))
      if (status) await record('note', buildDiabetesStatusPayload(status))
      for (const s of DIABETES_SYMPTOMS) {
        const v = symptoms[s.key]
        if (v) await record('note', buildDiabetesSymptomPayload(s.key, v))
      }

      if (lastEvent) {
        await onSaved(lastEvent)
        reset()
        onOpenChange(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      width="lg"
      title="Diabetes & blood sugar"
      description="Real, dated measurements and reported status — added to this patient's history, never overwriting an earlier entry."
      footer={
        <div>
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy || !hasAny}>
              <Droplet size={14} /> {busy ? 'Recording…' : 'Record'}
            </Button>
          </div>
          <p className="mt-2.5 text-[0.64rem] leading-relaxed text-ink-3">{SAFETY_DISCLAIMER}</p>
        </div>
      }
    >
      {error && (
        <div role="alert" className="mb-5 rounded-[10px] border border-rose/40 bg-rose/10 px-4 py-3 text-sm text-ink">
          {error}
        </div>
      )}

      <label className="mb-6 block text-sm font-medium text-ink">
        Date recorded
        <input type="date" max={todayInput()} className={`mt-1.5 ${numberInput}`} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>

      <CardLabel>Measurements</CardLabel>
      <LabField testName={DIABETES_LAB_TEST.HBA1C} value={hba1c} onChange={setHba1c} />
      <LabField testName={DIABETES_LAB_TEST.FASTING_GLUCOSE} value={fastingGlucose} onChange={setFastingGlucose} />
      <LabField testName={DIABETES_LAB_TEST.OGTT} value={ogtt} onChange={setOgtt} />

      <CardLabel className="mt-2">Diabetes status</CardLabel>
      <p className="mb-3 text-xs text-ink-3">What's already known or reported — not something this form calculates from the values above.</p>
      <div className="mb-6 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Diabetes status">
        {DIABETES_STATUS_VALUES.map((v) => (
          <ChipButton key={v} selected={status === v} tone="teal" onClick={() => setStatus(v)}>
            {DIABETES_STATUS_LABEL[v]}
          </ChipButton>
        ))}
      </div>

      <CardLabel>Symptoms</CardLabel>
      <p className="mb-3 text-xs text-ink-3">Reported presence, not a measurement — recorded as Yes, No, or Unknown.</p>
      <div className="space-y-4">
        {DIABETES_SYMPTOMS.map((s) => (
          <div key={s.key}>
            <p className="mb-1.5 text-sm font-medium text-ink">{s.label}</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={s.label}>
              {YES_NO_UNKNOWN_VALUES.map((v) => (
                <ChipButton
                  key={v}
                  selected={symptoms[s.key] === v}
                  onClick={() => setSymptoms((cur) => ({ ...cur, [s.key]: v }))}
                >
                  {YES_NO_UNKNOWN_LABEL[v]}
                </ChipButton>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  )
}
