import type { TimelineEvent } from '../../api/types'

/**
 * Diabetes & Blood Sugar — additive patient-record fields, deliberately
 * NOT part of the 21-feature model contract (intakeSchema.ts). BRFSS,
 * the dataset the production model is trained on, does not record blood
 * glucose or a prior diabetes diagnosis at all (see simulation_rules.py's
 * own comment on this) — Diabetes_012 is the survey's TARGET label, not
 * one of its input features. So none of this reaches the screening
 * model; it exists purely as richer Digital Twin patient history,
 * recorded the same way Height/Weight/BP already are.
 *
 * Two storage mechanisms, both pre-existing and already validated by the
 * backend — nothing new added there:
 *   - The three numeric measurements are `lab_result` events (exact same
 *     convention as HbA1c/Weight/BP already use — test_name + value +
 *     optional unit). "HbA1c" and "Fasting Glucose" reuse the literal
 *     test names CurrentHealthSection/TrendsSection/clinical_agent.py
 *     already key off of, so entries recorded here extend those same
 *     trend series and already flow into Clinical Analysis — not a
 *     parallel, disconnected series.
 *   - Diabetes status and the three symptoms are categorical/Yes-No-
 *     Unknown, not numeric, so they can't be `lab_result` (the backend
 *     requires a numeric `value`). They ride on `note` — which the
 *     backend validates only as "any JSON object" — with a small
 *     `kind` discriminator so the frontend can render them distinctly
 *     from free-text notes instead of falling into the generic
 *     "Note: <text>" rendering.
 */

export const DIABETES_LAB_TEST = {
  HBA1C: 'HbA1c',
  FASTING_GLUCOSE: 'Fasting Glucose',
  OGTT: '2-Hour Glucose Tolerance Test',
} as const

export const DIABETES_LAB_UNIT: Record<string, string> = {
  [DIABETES_LAB_TEST.HBA1C]: '%',
  [DIABETES_LAB_TEST.FASTING_GLUCOSE]: 'mg/dL',
  [DIABETES_LAB_TEST.OGTT]: 'mg/dL',
}

/**
 * Standard ADA diagnostic reference ranges — static educational text,
 * shown regardless of what (if anything) the user has typed. Never
 * compared against the live input to render a "your value is in the
 * diabetes range" callout: that would BE the frontend rendering a
 * diagnosis, which entering a number must never trigger on its own.
 */
export const DIABETES_LAB_REFERENCE: Record<string, { description: string; ranges: string }> = {
  [DIABETES_LAB_TEST.HBA1C]: {
    description: 'Reflects average blood glucose over roughly the past 2–3 months.',
    ranges: 'Reference (ADA): below 5.7% typical · 5.7–6.4% prediabetes range · 6.5% or above diabetes range.',
  },
  [DIABETES_LAB_TEST.FASTING_GLUCOSE]: {
    description: 'Blood glucose after at least 8 hours without food.',
    ranges: 'Reference (ADA): below 100 mg/dL typical · 100–125 mg/dL prediabetes range · 126 mg/dL or above diabetes range.',
  },
  [DIABETES_LAB_TEST.OGTT]: {
    description: 'Blood glucose 2 hours after drinking a standardized glucose solution.',
    ranges: 'Reference (ADA): below 140 mg/dL typical · 140–199 mg/dL prediabetes range · 200 mg/dL or above diabetes range.',
  },
}

export const DIABETES_STATUS_VALUES = ['not_diagnosed', 'prediabetes', 'diagnosed', 'unknown'] as const
export type DiabetesStatusValue = (typeof DIABETES_STATUS_VALUES)[number]

export const DIABETES_STATUS_LABEL: Record<DiabetesStatusValue, string> = {
  not_diagnosed: 'Not diagnosed',
  prediabetes: 'Prediabetes',
  diagnosed: 'Diagnosed diabetes',
  unknown: 'Unknown',
}

export const YES_NO_UNKNOWN_VALUES = ['yes', 'no', 'unknown'] as const
export type YesNoUnknown = (typeof YES_NO_UNKNOWN_VALUES)[number]

export const YES_NO_UNKNOWN_LABEL: Record<YesNoUnknown, string> = { yes: 'Yes', no: 'No', unknown: 'Unknown' }

export interface DiabetesSymptomDef {
  key: string
  label: string
}

export const DIABETES_SYMPTOMS: readonly DiabetesSymptomDef[] = [
  { key: 'frequent_urination', label: 'Frequent urination' },
  { key: 'excessive_thirst', label: 'Excessive thirst' },
  { key: 'persistent_fatigue', label: 'Persistent fatigue' },
]

const KIND_STATUS = 'diabetes_status'
const KIND_SYMPTOM = 'diabetes_symptom'

export function isDiabetesStatusEvent(e: TimelineEvent): boolean {
  return e.event_type === 'note' && e.payload.kind === KIND_STATUS
}

export function isDiabetesSymptomEvent(e: TimelineEvent): boolean {
  return e.event_type === 'note' && e.payload.kind === KIND_SYMPTOM
}

/** True for any structured diabetes note — used to keep these out of the
    generic free-text Symptoms list, which expects a `.text` payload. */
export function isStructuredDiabetesNote(e: TimelineEvent): boolean {
  return isDiabetesStatusEvent(e) || isDiabetesSymptomEvent(e)
}

export function buildDiabetesStatusPayload(value: DiabetesStatusValue): Record<string, unknown> {
  return { kind: KIND_STATUS, value }
}

export function buildDiabetesSymptomPayload(symptomKey: string, value: YesNoUnknown): Record<string, unknown> {
  return { kind: KIND_SYMPTOM, symptom: symptomKey, value }
}

export interface LatestDiabetesField {
  value: string
  recordedAt: string
}

/** Latest recorded diabetes status, or null if never recorded — walks
    the raw event log rather than relying on any server-side fold, since
    `note` events aren't part of STATE_EVENT_TYPES and so never appear
    in `current_state`. */
export function getLatestDiabetesStatus(events: TimelineEvent[]): LatestDiabetesField | null {
  const matches = events.filter(isDiabetesStatusEvent)
  if (!matches.length) return null
  const latest = [...matches].sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())[0]
  return { value: String(latest.payload.value), recordedAt: latest.recorded_at }
}

/** Latest recorded value for one symptom key, or null if never asked. */
export function getLatestSymptom(events: TimelineEvent[], symptomKey: string): LatestDiabetesField | null {
  const matches = events.filter((e) => isDiabetesSymptomEvent(e) && e.payload.symptom === symptomKey)
  if (!matches.length) return null
  const latest = [...matches].sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())[0]
  return { value: String(latest.payload.value), recordedAt: latest.recorded_at }
}
