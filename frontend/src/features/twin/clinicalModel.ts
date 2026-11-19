import type { LabRecord } from '../../api/types'
import { FIELD_LABEL, MEASUREMENT_KEYS, formatFieldValue } from '../intake/intakeSchema'

/**
 * The explicit mapping layer between richer clinical data and the
 * screening model's 21 trained features.
 *
 * Every function here either (a) computes an exact value from a real
 * formula/threshold — safe because the math itself is the fact, not an
 * inference — or (b) is a simple containment: the richer answer strictly
 * implies the BRFSS answer (e.g. "servings per day ≥ 1" IS the BRFSS
 * question, just asked with more precision). Nothing here infers a
 * DIAGNOSIS from a reading — a single blood-pressure reading does not
 * establish "ever told by a doctor you have high blood pressure", so
 * HighBP/HighChol/Stroke/HeartDiseaseOrAttack stay direct questions. See
 * each function's docstring for the exact source of its threshold.
 */

/** Canonical lab test names — entry and display must agree on these or a
    trend line silently splits into two series. */
export const LAB_TEST = {
  HEIGHT: 'Height',
  WEIGHT: 'Weight',
  BP_SYSTOLIC: 'Blood Pressure (Systolic)',
  BP_DIASTOLIC: 'Blood Pressure (Diastolic)',
  HEART_RATE: 'Heart Rate',
  // Lifestyle quantities. Recorded as their own trended lab_result entries
  // — not just folded into the BRFSS boolean and discarded — so "3
  // days/week" is real, redisplayable data, not a number invented at
  // render time to make the UI look richer than what was actually
  // recorded. See VitalsLabsDrawer's Lifestyle section, which writes both
  // this AND the derived measurement event in one submission.
  ACTIVITY_DAYS: 'Physical Activity (Days/Week)',
  ACTIVITY_MINUTES: 'Physical Activity (Minutes/Session)',
  SMOKING_CIGS: 'Smoking (Cigarettes/Day)',
  SMOKING_YEARS: 'Smoking (Years)',
  ALCOHOL_DRINKS: 'Alcohol (Drinks/Week)',
  FRUIT_SERVINGS: 'Fruit (Servings/Day)',
  VEGGIE_SERVINGS: 'Vegetable (Servings/Day)',
} as const

export const LAB_UNIT: Record<string, string> = {
  [LAB_TEST.HEIGHT]: 'cm',
  [LAB_TEST.WEIGHT]: 'kg',
  [LAB_TEST.BP_SYSTOLIC]: 'mmHg',
  [LAB_TEST.BP_DIASTOLIC]: 'mmHg',
  [LAB_TEST.HEART_RATE]: 'bpm',
  [LAB_TEST.ACTIVITY_DAYS]: 'days/wk',
  [LAB_TEST.ACTIVITY_MINUTES]: 'min',
  [LAB_TEST.SMOKING_CIGS]: 'cigs/day',
  [LAB_TEST.SMOKING_YEARS]: 'yrs',
  [LAB_TEST.ALCOHOL_DRINKS]: 'drinks/wk',
  [LAB_TEST.FRUIT_SERVINGS]: 'servings/day',
  [LAB_TEST.VEGGIE_SERVINGS]: 'servings/day',
}

/** Lab test names that represent lifestyle quantities rather than clinical
    vitals/labs — used to group the Current Health display correctly. */
export const LIFESTYLE_LAB_TESTS: readonly string[] = [
  LAB_TEST.ACTIVITY_DAYS, LAB_TEST.ACTIVITY_MINUTES, LAB_TEST.SMOKING_CIGS,
  LAB_TEST.SMOKING_YEARS, LAB_TEST.ALCOHOL_DRINKS, LAB_TEST.FRUIT_SERVINGS,
  LAB_TEST.VEGGIE_SERVINGS,
]

/** BMI = weight(kg) / height(m)². A formula, not an inference — this is
    the literal definition the `bmi` feature already uses. */
export function deriveBmi(heightCm: number, weightKg: number): number | null {
  if (!(heightCm > 0) || !(weightKg > 0)) return null
  const heightM = heightCm / 100
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10
}

/**
 * BRFSS `HvyAlcoholConsump` / CDC heavy-drinking definition: adult men
 * averaging more than 14 drinks/week, adult women more than 7 drinks/week
 * (CDC "Alcohol Use and Your Health"; the same threshold BRFSS's own
 * HvyAlcoholConsump derivation uses). Requires a scored sex encoding —
 * same requirement the model itself has — so an "other"/"unspecified"
 * patient gets `null` (cannot honestly apply a sex-specific threshold)
 * rather than a guessed value.
 */
export function deriveHvyAlcohol(drinksPerWeek: number, sex: string): 0 | 1 | null {
  if (!(drinksPerWeek >= 0)) return null
  if (sex === 'male') return drinksPerWeek > 14 ? 1 : 0
  if (sex === 'female') return drinksPerWeek > 7 ? 1 : 0
  return null
}

/** BRFSS `PhysActivity` literally asks "any physical activity in the past
    30 days, not counting your job" — any nonzero frequency answers it. */
export function derivePhysActivity(daysPerWeek: number): 0 | 1 {
  return daysPerWeek > 0 ? 1 : 0
}

/** BRFSS `Fruits`/`Veggies` literally ask "do you eat [X] one or more
    times per day" — a servings-per-day count strictly contains that
    answer, not an approximation of it. */
export function deriveServingsFlag(servingsPerDay: number): 0 | 1 {
  return servingsPerDay >= 1 ? 1 : 0
}

export type SmokingStatus = 'never' | 'former' | 'current'

/**
 * BRFSS `Smoker` asks "smoked at least 100 cigarettes in your entire
 * life" — a lifetime threshold, not a current-status question. Mapping
 * never→No is exact. Mapping former/current→Yes is an approximation
 * (a very recent, very light smoker could in principle be under 100
 * lifetime cigarettes) — stated here, not hidden, and shown as such in
 * the UI copy wherever this is offered as an alternative to answering the
 * lifetime question directly.
 */
export function deriveSmokerFromStatus(status: SmokingStatus): 0 | 1 {
  return status === 'never' ? 0 : 1
}

const CHOLESTEROL_LAB_PATTERN = /cholesterol|lipid/i

/** BRFSS `CholCheck` asks "cholesterol checked within the past 5 years" —
    the presence of a dated cholesterol/lipid lab result within 5 years
    answers this directly; no clinical judgement involved, just a date
    comparison. */
export function deriveCholCheck(labs: LabRecord[], now: Date = new Date()): 0 | 1 | null {
  if (!labs.length) return null
  const fiveYearsAgo = new Date(now)
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)
  const hasRecent = labs.some(
    (l) => CHOLESTEROL_LAB_PATTERN.test(l.test_name) && new Date(l.recorded_at) >= fiveYearsAgo,
  )
  return hasRecent ? 1 : 0
}

/** Which richer inputs, if recorded, would let this feature be derived
    rather than answered directly — shown in the Model Feature Mapping
    panel so a missing feature has a concrete next step, not just a
    red "missing" label. */
export const DERIVABLE_FROM: Partial<Record<string, string>> = {
  bmi: 'Height + Weight (Vitals & Labs)',
  hvy_alcohol_consump: 'Alcohol frequency (drinks/week)',
  phys_activity: 'Activity frequency (days/week)',
  fruits: 'Fruit servings/day',
  veggies: 'Vegetable servings/day',
  chol_check: 'A cholesterol/lipid lab recorded within 5 years',
}

export interface FeatureMapping {
  key: string
  label: string
  present: boolean
  value: string
  derivableFrom?: string
}

/**
 * Renders the full 21-feature picture with honest provenance. `present`
 * mirrors exactly what `computeReadiness`/the backend's own
 * `check_eligibility` would see — this never claims a feature is usable
 * when the model itself would refuse to score it.
 */
export function buildFeatureMapping(state: Record<string, unknown> | undefined | null): FeatureMapping[] {
  const s = state ?? {}
  const sexPresent = s.sex === 'female' || s.sex === 'male'
  const agePresent = s.age !== undefined && s.age !== null

  const rows: FeatureMapping[] = [
    { key: 'sex', label: 'Sex', present: sexPresent, value: sexPresent ? String(s.sex) : 'Missing' },
    { key: 'age', label: 'Age', present: agePresent, value: agePresent ? `${s.age} yrs` : 'Missing' },
  ]

  for (const key of MEASUREMENT_KEYS) {
    const present = s[key] !== undefined && s[key] !== null
    rows.push({
      key,
      label: FIELD_LABEL[key] ?? key,
      present,
      value: present ? formatFieldValue(key, s[key]) : 'Missing',
      derivableFrom: !present ? DERIVABLE_FROM[key] : undefined,
    })
  }
  return rows
}
