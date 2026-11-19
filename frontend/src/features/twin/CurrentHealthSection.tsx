import { Activity, Droplet, FlaskConical, HeartPulse, ListChecks, NotebookPen, Pill, Ruler } from 'lucide-react'
import type { DigitalTwin, LabRecord, TimelineEvent } from '../../api/types'
import { Button, Card, CardLabel } from '../../design-system'
import { CARDIOMETABOLIC, FUNCTIONAL_YESNO, HEALTHCARE } from '../intake/intakeSchema'
import { LAB_TEST } from './clinicalModel'
import {
  DIABETES_LAB_TEST,
  DIABETES_STATUS_LABEL,
  DIABETES_SYMPTOMS,
  YES_NO_UNKNOWN_LABEL,
  getLatestDiabetesStatus,
  getLatestSymptom,
  type DiabetesStatusValue,
  type YesNoUnknown,
} from './diabetesModel'

function MeasurementCard({
  label,
  value,
  unit,
  date,
  secondary,
}: {
  label: string
  value: string
  unit?: string
  date?: string
  secondary?: string
}) {
  return (
    <div className="data-surface rounded-[14px] p-4">
      <p className="text-[0.62rem] font-bold tracking-[0.14em] text-ink-3 uppercase">{label}</p>
      <p className="mt-1.5 font-mono text-xl font-bold tabular-nums text-ink">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-ink-3">{unit}</span>}
      </p>
      {secondary && <p className="mt-0.5 text-xs text-ink-2">{secondary}</p>}
      {date && <p className="mt-1 text-[0.66rem] text-ink-3">{new Date(date).toLocaleDateString()}</p>}
    </div>
  )
}

function NotRecordedCard({ label }: { label: string }) {
  return (
    <div className="rounded-[14px] border border-dashed border-border-strong p-4">
      <p className="text-[0.62rem] font-bold tracking-[0.14em] text-ink-3 uppercase">{label}</p>
      <p className="mt-1.5 text-sm text-ink-3">Not recorded</p>
    </div>
  )
}

const CONDITION_KEYS = [...CARDIOMETABOLIC, ...FUNCTIONAL_YESNO]

/**
 * The main "what does this patient's health look like right now" view.
 * Every card pulls from one of three real sources — never a fourth,
 * invented one:
 *   - `twin.laboratory.latest` (GET /api/twin/{id}/digital-twin) for
 *     Height/Weight/BP/Heart rate/HbA1c/Glucose/Cholesterol/lifestyle
 *     quantities.
 *   - `currentState` (the materialized BRFSS fold) for General/Physical/
 *     Mental health, diagnosis-history conditions, lifestyle booleans
 *     when no richer quantity exists, and Height/Weight when no dated
 *     lab_result exists but the folded `height_m`/`weight_kg` does —
 *     the same fallback Trends already merges in for its Weight chart.
 *   - `twin.medications.current` / `notes` for medications and symptoms.
 *   - `events` (the raw log) for Diabetes status and symptoms —
 *     structured `note` events that, unlike labs/medications, the
 *     backend doesn't fold into any "latest" view, so this section
 *     reads the log itself via diabetesModel.ts's helpers.
 * A card only appears where that source actually holds a value —
 * anything genuinely absent renders "Not recorded", never a placeholder
 * number.
 */
export function CurrentHealthSection({
  currentState,
  twin,
  notes,
  events,
  onRecordVitals,
  onRecordMedication,
  onAddNote,
  onRecordDiabetesInfo,
}: {
  currentState: Record<string, unknown>
  twin: DigitalTwin | null
  notes: TimelineEvent[]
  /** Raw event log — needed to read Diabetes status/symptoms, which
      (unlike labs/medications) aren't folded server-side into `twin` or
      `currentState`. See diabetesModel.ts. */
  events: TimelineEvent[]
  onRecordVitals: () => void
  onRecordMedication: () => void
  onAddNote: () => void
  onRecordDiabetesInfo: () => void
}) {
  const labs = twin?.laboratory.latest ?? {}
  const lab = (name: string): LabRecord | undefined => labs[name]

  const height = lab(LAB_TEST.HEIGHT)
  const weight = lab(LAB_TEST.WEIGHT)
  // Older recorded history (and the intake wizard's baseline) carries
  // height/weight as `height_m`/`weight_kg` on the folded model state
  // rather than as a dated lab_result — the same convention Trends
  // already merges in. Falling back to it here is what keeps this card
  // consistent with the Weight/BMI charts just below, which do show a
  // value for the exact same patient.
  const heightFallbackM = typeof currentState.height_m === 'number' ? currentState.height_m : null
  const weightFallbackKg = typeof currentState.weight_kg === 'number' ? currentState.weight_kg : null
  const systolic = lab(LAB_TEST.BP_SYSTOLIC)
  const diastolic = lab(LAB_TEST.BP_DIASTOLIC)
  const heartRate = lab(LAB_TEST.HEART_RATE)
  const hba1c = lab(DIABETES_LAB_TEST.HBA1C)
  const glucose = lab(DIABETES_LAB_TEST.FASTING_GLUCOSE)
  const ogtt = lab(DIABETES_LAB_TEST.OGTT)
  const cholesterol = lab('Total Cholesterol')

  const diabetesStatus = getLatestDiabetesStatus(events)
  const diabetesSymptoms = DIABETES_SYMPTOMS.map((s) => ({ ...s, latest: getLatestSymptom(events, s.key) }))
  const hasDiabetesInfo = diabetesStatus !== null || diabetesSymptoms.some((s) => s.latest !== null)

  const bmi = currentState.bmi

  const genHlth = currentState.gen_hlth
  const GEN_HLTH_LABEL: Record<string, string> = { '1': 'Excellent', '2': 'Very good', '3': 'Good', '4': 'Fair', '5': 'Poor' }
  const physHlth = currentState.phys_hlth
  const mentHlth = currentState.ment_hlth

  const conditions = CONDITION_KEYS.filter((d) => Number(currentState[d.key]) === 1)
  const medications = twin?.medications.current ?? []
  const recentNotes = [...notes].sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()).slice(0, 3)

  // Lifestyle: prefer a real recorded quantity; fall back to the plain
  // BRFSS Yes/No only when no richer reading exists for that domain.
  const activityDays = lab(LAB_TEST.ACTIVITY_DAYS)
  const activityMinutes = lab(LAB_TEST.ACTIVITY_MINUTES)
  const smokingCigs = lab(LAB_TEST.SMOKING_CIGS)
  const smokingYears = lab(LAB_TEST.SMOKING_YEARS)
  const alcoholDrinks = lab(LAB_TEST.ALCOHOL_DRINKS)
  const fruitServings = lab(LAB_TEST.FRUIT_SERVINGS)
  const veggieServings = lab(LAB_TEST.VEGGIE_SERVINGS)

  return (
    <div className="mb-10">
      <div className="mb-3 flex items-center justify-between gap-3">
        <CardLabel className="mb-0">Current health</CardLabel>
        <Button variant="secondary" size="sm" onClick={onRecordVitals}>
          <FlaskConical size={13} /> Record vitals, labs & lifestyle
        </Button>
      </div>

      {/* Body & vitals */}
      <p className="mb-2 flex items-center gap-1.5 text-[0.66rem] font-bold tracking-[0.14em] text-ink-3 uppercase">
        <Ruler size={11} /> Body & vitals
      </p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {height ? (
          <MeasurementCard label="Height" value={String(height.value)} unit={height.unit} date={height.recorded_at} />
        ) : heightFallbackM !== null ? (
          <MeasurementCard label="Height" value={(heightFallbackM * 100).toFixed(0)} unit="cm" />
        ) : (
          <NotRecordedCard label="Height" />
        )}
        {weight ? (
          <MeasurementCard label="Weight" value={String(weight.value)} unit={weight.unit} date={weight.recorded_at} />
        ) : weightFallbackKg !== null ? (
          <MeasurementCard label="Weight" value={String(weightFallbackKg)} unit="kg" />
        ) : (
          <NotRecordedCard label="Weight" />
        )}
        {bmi !== undefined && bmi !== null ? <MeasurementCard label="BMI" value={String(bmi)} unit="kg/m²" /> : <NotRecordedCard label="BMI" />}
        {systolic && diastolic ? (
          <MeasurementCard label="Blood pressure" value={`${systolic.value}/${diastolic.value}`} unit="mmHg" date={systolic.recorded_at} />
        ) : (
          <NotRecordedCard label="Blood pressure" />
        )}
        {heartRate ? <MeasurementCard label="Heart rate" value={String(heartRate.value)} unit={heartRate.unit} date={heartRate.recorded_at} /> : <NotRecordedCard label="Heart rate" />}
      </div>

      {/* Laboratory */}
      <p className="mb-2 flex items-center gap-1.5 text-[0.66rem] font-bold tracking-[0.14em] text-ink-3 uppercase">
        <HeartPulse size={11} /> Laboratory
      </p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {hba1c ? <MeasurementCard label="HbA1c" value={String(hba1c.value)} unit={hba1c.unit ?? '%'} date={hba1c.recorded_at} /> : <NotRecordedCard label="HbA1c" />}
        {glucose ? <MeasurementCard label="Fasting glucose" value={String(glucose.value)} unit={glucose.unit} date={glucose.recorded_at} /> : <NotRecordedCard label="Fasting glucose" />}
        {ogtt ? <MeasurementCard label="2-hour glucose tolerance" value={String(ogtt.value)} unit={ogtt.unit} date={ogtt.recorded_at} /> : <NotRecordedCard label="2-hour glucose tolerance" />}
        {cholesterol ? <MeasurementCard label="Total cholesterol" value={String(cholesterol.value)} unit={cholesterol.unit} date={cholesterol.recorded_at} /> : <NotRecordedCard label="Total cholesterol" />}
      </div>

      {/* Diabetes status & symptoms — patient-reported, not derived from
          the lab values above. Recording "Diagnosed diabetes" here is
          entering a reported fact (the same kind of direct question as
          "High blood pressure: Yes/No" elsewhere), never something this
          page computes from HbA1c/glucose. */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[0.66rem] font-bold tracking-[0.14em] text-ink-3 uppercase">
            <Droplet size={11} /> Diabetes status &amp; symptoms
          </p>
          <button
            type="button"
            onClick={onRecordDiabetesInfo}
            aria-label="Record diabetes & blood sugar info"
            className="text-ink-3 transition-colors hover:text-teal"
          >
            <Droplet size={13} />
          </button>
        </div>
        {hasDiabetesInfo ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {diabetesStatus ? (
              <MeasurementCard
                label="Diabetes status"
                value={DIABETES_STATUS_LABEL[diabetesStatus.value as DiabetesStatusValue] ?? diabetesStatus.value}
                date={diabetesStatus.recordedAt}
              />
            ) : (
              <NotRecordedCard label="Diabetes status" />
            )}
            {diabetesSymptoms.map((s) =>
              s.latest ? (
                <MeasurementCard
                  key={s.key}
                  label={s.label}
                  value={YES_NO_UNKNOWN_LABEL[s.latest.value as YesNoUnknown] ?? s.latest.value}
                  date={s.latest.recordedAt}
                />
              ) : (
                <NotRecordedCard key={s.key} label={s.label} />
              ),
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={onRecordDiabetesInfo}
            className="w-full rounded-[14px] border border-dashed border-border-strong p-4 text-left text-sm text-ink-3 transition-colors hover:border-teal/40 hover:text-ink-2"
          >
            No diabetes status or symptoms recorded yet — click to add.
          </button>
        )}
      </div>

      {/* Self-reported health */}
      <p className="mb-2 flex items-center gap-1.5 text-[0.66rem] font-bold tracking-[0.14em] text-ink-3 uppercase">
        <Activity size={11} /> Self-reported health
      </p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {genHlth !== undefined ? <MeasurementCard label="General health" value={GEN_HLTH_LABEL[String(genHlth)] ?? String(genHlth)} /> : <NotRecordedCard label="General health" />}
        {physHlth !== undefined ? <MeasurementCard label="Physical health" value={String(physHlth)} unit="days of 30" secondary="poor physical-health days, past 30" /> : <NotRecordedCard label="Physical health" />}
        {mentHlth !== undefined ? <MeasurementCard label="Mental health" value={String(mentHlth)} unit="days of 30" secondary="poor mental-health days, past 30" /> : <NotRecordedCard label="Mental health" />}
      </div>

      {/* Lifestyle */}
      <p className="mb-2 flex items-center gap-1.5 text-[0.66rem] font-bold tracking-[0.14em] text-ink-3 uppercase">
        <Activity size={11} /> Lifestyle
      </p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {activityDays ? (
          <MeasurementCard
            label="Physical activity"
            value={String(activityDays.value)}
            unit="days/wk"
            secondary={activityMinutes ? `~${activityMinutes.value} min/session` : undefined}
            date={activityDays.recorded_at}
          />
        ) : (
          <MeasurementCard label="Physical activity" value={currentState.phys_activity ? 'Yes' : 'No'} secondary="any activity, past 30 days" />
        )}
        {smokingCigs || smokingYears ? (
          <MeasurementCard
            label="Smoking"
            value={smokingCigs ? String(smokingCigs.value) : '—'}
            unit={smokingCigs ? 'cigs/day' : undefined}
            secondary={smokingYears ? `${smokingYears.value} yr history` : undefined}
            date={(smokingCigs ?? smokingYears)?.recorded_at}
          />
        ) : (
          <MeasurementCard label="Smoking" value={currentState.smoker ? 'Yes' : 'No'} secondary="≥100 cigarettes, lifetime" />
        )}
        {alcoholDrinks ? (
          <MeasurementCard label="Alcohol" value={String(alcoholDrinks.value)} unit="drinks/wk" date={alcoholDrinks.recorded_at} />
        ) : (
          <MeasurementCard label="Heavy alcohol use" value={currentState.hvy_alcohol_consump ? 'Yes' : 'No'} />
        )}
        {fruitServings ? (
          <MeasurementCard label="Fruit" value={String(fruitServings.value)} unit="servings/day" date={fruitServings.recorded_at} />
        ) : (
          <MeasurementCard label="Fruit consumption" value={currentState.fruits ? 'Yes' : 'No'} secondary="≥1/day" />
        )}
        {veggieServings ? (
          <MeasurementCard label="Vegetables" value={String(veggieServings.value)} unit="servings/day" date={veggieServings.recorded_at} />
        ) : (
          <MeasurementCard label="Vegetable consumption" value={currentState.veggies ? 'Yes' : 'No'} secondary="≥1/day" />
        )}
      </div>

      {/* Conditions, symptoms, medications */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[0.66rem] font-bold tracking-[0.14em] text-ink-3 uppercase">
            <ListChecks size={11} /> Conditions
          </p>
          <Card layer="data" pad="none" className="overflow-hidden">
            {conditions.length === 0 ? (
              <p className="p-4 text-sm text-ink-3">No conditions on file.</p>
            ) : (
              <ul className="divide-y divide-border-strong">
                {conditions.map((c) => (
                  <li key={c.key} className="px-4 py-2.5 text-sm text-ink">{c.label}</li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[0.66rem] font-bold tracking-[0.14em] text-ink-3 uppercase">
              <NotebookPen size={11} /> Symptoms
            </p>
            <button
              type="button"
              onClick={onAddNote}
              aria-label="Add a note"
              className="text-ink-3 transition-colors hover:text-teal"
            >
              <NotebookPen size={13} />
            </button>
          </div>
          <Card layer="data" pad="none" className="overflow-hidden">
            {recentNotes.length === 0 ? (
              <p className="p-4 text-sm text-ink-3">No symptoms recorded.</p>
            ) : (
              <ul className="divide-y divide-border-strong">
                {recentNotes.map((n) => (
                  <li key={n.id} className="px-4 py-2.5 text-sm">
                    <p className="text-ink">{String(n.payload.text ?? '')}</p>
                    <p className="mt-0.5 text-[0.66rem] text-ink-3">{new Date(n.recorded_at).toLocaleDateString()}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[0.66rem] font-bold tracking-[0.14em] text-ink-3 uppercase">
              <Pill size={11} /> Medications
            </p>
            <button
              type="button"
              onClick={onRecordMedication}
              aria-label="Record medication change"
              className="text-ink-3 transition-colors hover:text-teal"
            >
              <Pill size={13} />
            </button>
          </div>
          <Card layer="data" pad="none" className="overflow-hidden">
            {medications.length === 0 ? (
              <p className="p-4 text-sm text-ink-3">No medications recorded.</p>
            ) : (
              <ul className="divide-y divide-border-strong">
                {medications.map((m, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0 truncate text-ink">{m.medication_name}</span>
                    <span className="shrink-0 text-xs text-ink-3">{m.dose ?? m.action}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* Healthcare access — deliberately minimized. Not health information;
          shown only for completeness, not given card-level prominence.
          Education/Income are omitted entirely here — they're model
          features, not health state; see the Model Feature Mapping
          section (Advanced) for why they're collected at all. */}
      {(currentState.any_healthcare !== undefined || currentState.no_doc_bc_cost !== undefined) && (
        <p className="mt-4 text-xs text-ink-3">
          {HEALTHCARE.filter((h) => currentState[h.key] !== undefined)
            .map((h) => `${h.label}: ${currentState[h.key] ? 'Yes' : 'No'}`)
            .join(' · ')}
        </p>
      )}
    </div>
  )
}
