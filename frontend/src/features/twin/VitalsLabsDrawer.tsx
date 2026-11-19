import { FlaskConical, Ruler } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api/client'
import type { TimelineEvent } from '../../api/types'
import { Button, CardLabel, ChipButton, Drawer, SAFETY_DISCLAIMER } from '../../design-system'
import {
  LAB_TEST,
  LAB_UNIT,
  deriveBmi,
  deriveHvyAlcohol,
  derivePhysActivity,
  deriveServingsFlag,
  deriveSmokerFromStatus,
  type SmokingStatus,
} from './clinicalModel'

const COMMON_LABS = ['HbA1c', 'Fasting Glucose', 'Total Cholesterol', 'LDL Cholesterol', 'HDL Cholesterol', 'Triglycerides', 'Creatinine']

const todayInput = () => new Date().toISOString().slice(0, 10)

const numberInput =
  'w-full rounded-[10px] border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-teal focus-visible:outline-none'

/**
 * Records vitals, labs, and lifestyle quantities as `lab_result` events —
 * the backend's already-validated, already-trended event type
 * (twin_service.validate_lab_result_payload, get_lab_trend), previously
 * unexposed in the frontend. `lab_result` is deliberately NOT in
 * STATE_EVENT_TYPES, so nothing recorded here is read by the screening
 * model on its own — it's tracked, historical, clinical context.
 *
 * Two exceptions, both explicit rather than automatic-and-invisible:
 *   - Height + Weight together also write a `measurement` event with the
 *     computed BMI (an exact formula, not an inference).
 *   - Each Lifestyle quantity (activity, smoking, alcohol, diet) also
 *     writes the BRFSS boolean it derives, via the same threshold
 *     functions the Edit Patient wizard uses — see clinicalModel.ts for
 *     the exact source of each threshold. The quantity itself is ALSO
 *     kept as its own lab_result, so "3 days/week" is real, redisplayable,
 *     trendable data — not a number that gets computed once and thrown
 *     away, which is what the wizard's quick-entry fields do on their own.
 */
export function VitalsLabsDrawer({
  open,
  onOpenChange,
  patientId,
  sex,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: number
  /** Needed for the sex-specific heavy-alcohol threshold — see
      clinicalModel.deriveHvyAlcohol. */
  sex: string
  onSaved: (event: TimelineEvent) => Promise<void> | void
}) {
  const [heightCm, setHeightCm] = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [systolic, setSystolic] = useState('')
  const [diastolic, setDiastolic] = useState('')
  const [heartRate, setHeartRate] = useState('')
  const [labName, setLabName] = useState('')
  const [labValue, setLabValue] = useState('')
  const [labUnit, setLabUnit] = useState('')

  const [activityDays, setActivityDays] = useState('')
  const [activityMinutes, setActivityMinutes] = useState('')
  const [smokingStatus, setSmokingStatus] = useState<SmokingStatus | ''>('')
  const [smokingCigs, setSmokingCigs] = useState('')
  const [smokingYears, setSmokingYears] = useState('')
  const [alcoholDrinks, setAlcoholDrinks] = useState('')
  const [fruitServings, setFruitServings] = useState('')
  const [veggieServings, setVeggieServings] = useState('')

  const [date, setDate] = useState(todayInput())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bmi = deriveBmi(Number(heightCm), Number(weightKg))
  const hasAny = Boolean(
    heightCm || weightKg || systolic || diastolic || heartRate || (labName && labValue) ||
    activityDays || activityMinutes || smokingStatus || smokingCigs || smokingYears ||
    alcoholDrinks || fruitServings || veggieServings,
  )

  const reset = () => {
    setHeightCm(''); setWeightKg(''); setSystolic(''); setDiastolic(''); setHeartRate('')
    setLabName(''); setLabValue(''); setLabUnit(''); setDate(todayInput())
    setActivityDays(''); setActivityMinutes(''); setSmokingStatus(''); setSmokingCigs(''); setSmokingYears('')
    setAlcoholDrinks(''); setFruitServings(''); setVeggieServings('')
    setError(null)
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    // Only pass an explicit recorded_at when the user actually backdated
    // this entry. The date picker defaults to today, which as a fixed
    // midnight timestamp would make a "record now" entry sort BEFORE any
    // other event already recorded earlier today with a real clock time —
    // inverting the very order this append-only log exists to preserve.
    // Omitting it lets the backend default to the true current instant
    // (twin_service.append_event), which is what "record now" should mean.
    const backdated = date !== todayInput()
    const recordedAt = backdated ? new Date(date).toISOString() : undefined
    try {
      let lastEvent: TimelineEvent | null = null
      const record = async (event_type: string, payload: Record<string, unknown>) => {
        lastEvent = await api.appendEvent(patientId, { event_type, payload, ...(recordedAt ? { recorded_at: recordedAt } : {}) })
      }
      const lab = (test_name: string, value: number, unit?: string) =>
        record('lab_result', { test_name, value, ...(unit ? { unit } : {}) })

      if (heightCm) await lab(LAB_TEST.HEIGHT, Number(heightCm), LAB_UNIT[LAB_TEST.HEIGHT])
      if (weightKg) await lab(LAB_TEST.WEIGHT, Number(weightKg), LAB_UNIT[LAB_TEST.WEIGHT])
      if (systolic) await lab(LAB_TEST.BP_SYSTOLIC, Number(systolic), LAB_UNIT[LAB_TEST.BP_SYSTOLIC])
      if (diastolic) await lab(LAB_TEST.BP_DIASTOLIC, Number(diastolic), LAB_UNIT[LAB_TEST.BP_DIASTOLIC])
      if (heartRate) await lab(LAB_TEST.HEART_RATE, Number(heartRate), LAB_UNIT[LAB_TEST.HEART_RATE])
      if (labName && labValue) await lab(labName, Number(labValue), labUnit || undefined)
      if (bmi !== null) await record('measurement', { bmi })

      // Lifestyle: record the real quantity, then derive+write the BRFSS
      // boolean it implies (see clinicalModel.ts for each threshold).
      if (activityDays) {
        await lab(LAB_TEST.ACTIVITY_DAYS, Number(activityDays), LAB_UNIT[LAB_TEST.ACTIVITY_DAYS])
        if (activityMinutes) await lab(LAB_TEST.ACTIVITY_MINUTES, Number(activityMinutes), LAB_UNIT[LAB_TEST.ACTIVITY_MINUTES])
        await record('lifestyle_log', { phys_activity: derivePhysActivity(Number(activityDays)) })
      }
      if (smokingStatus) {
        if (smokingCigs) await lab(LAB_TEST.SMOKING_CIGS, Number(smokingCigs), LAB_UNIT[LAB_TEST.SMOKING_CIGS])
        if (smokingYears) await lab(LAB_TEST.SMOKING_YEARS, Number(smokingYears), LAB_UNIT[LAB_TEST.SMOKING_YEARS])
        await record('lifestyle_log', { smoker: deriveSmokerFromStatus(smokingStatus) })
      }
      if (alcoholDrinks) {
        await lab(LAB_TEST.ALCOHOL_DRINKS, Number(alcoholDrinks), LAB_UNIT[LAB_TEST.ALCOHOL_DRINKS])
        const derived = deriveHvyAlcohol(Number(alcoholDrinks), sex)
        if (derived !== null) await record('lifestyle_log', { hvy_alcohol_consump: derived })
      }
      if (fruitServings) {
        await lab(LAB_TEST.FRUIT_SERVINGS, Number(fruitServings), LAB_UNIT[LAB_TEST.FRUIT_SERVINGS])
        await record('lifestyle_log', { fruits: deriveServingsFlag(Number(fruitServings)) })
      }
      if (veggieServings) {
        await lab(LAB_TEST.VEGGIE_SERVINGS, Number(veggieServings), LAB_UNIT[LAB_TEST.VEGGIE_SERVINGS])
        await record('lifestyle_log', { veggies: deriveServingsFlag(Number(veggieServings)) })
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
      title="Record vitals, labs & lifestyle"
      description="Real, dated measurements — tracked and trended over time, separate from the model baseline."
      footer={
        <div>
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy || !hasAny}>
              <FlaskConical size={14} /> {busy ? 'Recording…' : 'Record'}
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

      <CardLabel>Height & weight</CardLabel>
      <div className="mb-2 grid grid-cols-2 gap-4">
        <label className="block text-sm font-medium text-ink">
          Height
          <div className="relative mt-1.5">
            <input type="number" min={1} step="any" className={numberInput} value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-3">cm</span>
          </div>
        </label>
        <label className="block text-sm font-medium text-ink">
          Weight
          <div className="relative mt-1.5">
            <input type="number" min={1} step="any" className={numberInput} value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-3">kg</span>
          </div>
        </label>
      </div>
      {bmi !== null && (
        <p className="mb-6 flex items-center gap-2 rounded-[10px] border border-teal/30 bg-teal/8 px-3 py-2 text-xs text-ink-2">
          <Ruler size={13} className="shrink-0 text-teal" />
          BMI <strong className="text-ink">{bmi}</strong> — this will also update the model baseline's BMI feature.
        </p>
      )}

      <CardLabel>Blood pressure & heart rate</CardLabel>
      <p className="mb-2 text-xs text-ink-3">
        Readings, tracked over time — separate from the "High blood pressure" diagnosis question in Edit Patient
        Baseline, which asks about a doctor's diagnosis, not a single reading.
      </p>
      <div className="mb-6 grid grid-cols-3 gap-4">
        <label className="block text-sm font-medium text-ink">
          Systolic
          <div className="relative mt-1.5">
            <input type="number" min={1} className={numberInput} value={systolic} onChange={(e) => setSystolic(e.target.value)} />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-3">mmHg</span>
          </div>
        </label>
        <label className="block text-sm font-medium text-ink">
          Diastolic
          <div className="relative mt-1.5">
            <input type="number" min={1} className={numberInput} value={diastolic} onChange={(e) => setDiastolic(e.target.value)} />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-3">mmHg</span>
          </div>
        </label>
        <label className="block text-sm font-medium text-ink">
          Heart rate
          <div className="relative mt-1.5">
            <input type="number" min={1} className={numberInput} value={heartRate} onChange={(e) => setHeartRate(e.target.value)} />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-3">bpm</span>
          </div>
        </label>
      </div>

      <CardLabel>Lab result</CardLabel>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_auto]">
        <label className="block text-sm font-medium text-ink">
          Test
          <input
            list="common-labs"
            className={`mt-1.5 ${numberInput}`}
            value={labName}
            onChange={(e) => setLabName(e.target.value)}
            placeholder="e.g. HbA1c"
          />
          <datalist id="common-labs">
            {COMMON_LABS.map((l) => <option key={l} value={l} />)}
          </datalist>
        </label>
        <label className="block text-sm font-medium text-ink">
          Value
          <input type="number" step="any" className={`mt-1.5 w-28 ${numberInput}`} value={labValue} onChange={(e) => setLabValue(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-ink">
          Unit
          <input className={`mt-1.5 w-20 ${numberInput}`} value={labUnit} onChange={(e) => setLabUnit(e.target.value)} placeholder="e.g. %" />
        </label>
      </div>

      <CardLabel>Lifestyle</CardLabel>
      <p className="mb-3 text-xs text-ink-3">
        Real quantities, kept and trended — each one also updates the corresponding model feature using the exact
        BRFSS threshold (see the Model Feature Mapping section for details).
      </p>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <label className="block text-sm font-medium text-ink">
          Activity — days/week
          <input type="number" min={0} max={7} className={`mt-1.5 ${numberInput}`} value={activityDays} onChange={(e) => setActivityDays(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-ink">
          Minutes/session <span className="font-normal text-ink-3">(optional)</span>
          <input type="number" min={0} className={`mt-1.5 ${numberInput}`} value={activityMinutes} onChange={(e) => setActivityMinutes(e.target.value)} />
        </label>
      </div>

      <div className="mb-4">
        <p className="mb-1.5 text-sm font-medium text-ink">Smoking status</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Smoking status">
          {(['never', 'former', 'current'] as const).map((s) => (
            <ChipButton key={s} selected={smokingStatus === s} tone="teal" onClick={() => setSmokingStatus(s)}>
              {s === 'never' ? 'Never smoked' : s === 'former' ? 'Former smoker' : 'Current smoker'}
            </ChipButton>
          ))}
        </div>
        {smokingStatus && smokingStatus !== 'never' && (
          <div className="mt-3 grid grid-cols-2 gap-4">
            <label className="block text-sm font-medium text-ink">
              Cigarettes/day <span className="font-normal text-ink-3">(optional)</span>
              <input type="number" min={0} className={`mt-1.5 ${numberInput}`} value={smokingCigs} onChange={(e) => setSmokingCigs(e.target.value)} />
            </label>
            <label className="block text-sm font-medium text-ink">
              Years <span className="font-normal text-ink-3">(optional)</span>
              <input type="number" min={0} className={`mt-1.5 ${numberInput}`} value={smokingYears} onChange={(e) => setSmokingYears(e.target.value)} />
            </label>
          </div>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4">
        <label className="block text-sm font-medium text-ink">
          Alcohol — drinks/week
          <input type="number" min={0} step="any" className={`mt-1.5 ${numberInput}`} value={alcoholDrinks} onChange={(e) => setAlcoholDrinks(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="block text-sm font-medium text-ink">
          Fruit — servings/day
          <input type="number" min={0} step="any" className={`mt-1.5 ${numberInput}`} value={fruitServings} onChange={(e) => setFruitServings(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-ink">
          Vegetables — servings/day
          <input type="number" min={0} step="any" className={`mt-1.5 ${numberInput}`} value={veggieServings} onChange={(e) => setVeggieServings(e.target.value)} />
        </label>
      </div>
    </Drawer>
  )
}
