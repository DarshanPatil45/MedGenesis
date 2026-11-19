import {
  Activity,
  Banknote,
  ClipboardCheck,
  Heart,
  IdCard,
  Salad,
  Stethoscope,
  type LucideIcon,
} from 'lucide-react'

/**
 * Single source of truth for the intake wizard's field contract.
 *
 * Every key below maps 1:1 onto a snake_case twin-state key the backend
 * reads (`backend/app/agents/screening_agent.py::FEATURE_KEY_MAP`) — do not
 * rename, add, or remove keys here without confirming against that map
 * first. `pseudonym` is the one field in the wizard that is NOT one of the
 * model's 21 trained features: it is a workspace label only, stored on the
 * Patient row and never read by the screening model.
 *
 * The model needs exactly 21 features: `age` and `sex` are read directly
 * from the Patient row (converted server-side — age into a 13-bucket BRFSS
 * age band, sex into 0/1); the remaining 19 travel inside
 * `baseline_measurements`, written as one `measurement` timeline event.
 * `buildPayload` below is the only place that assembles that dict, so the
 * wizard steps and the request body can never drift apart.
 */

export const MODEL_FEATURE_COUNT = 21

export type FormState = {
  pseudonym: string
  age: string
  sex: string
  bmi: string
  gen_hlth: string
  ment_hlth: string
  phys_hlth: string
  education: string
  income: string
  high_bp: boolean
  high_chol: boolean
  chol_check: boolean
  stroke: boolean
  heart_disease_or_attack: boolean
  diff_walk: boolean
  smoker: boolean
  phys_activity: boolean
  fruits: boolean
  veggies: boolean
  hvy_alcohol_consump: boolean
  any_healthcare: boolean
  no_doc_bc_cost: boolean
}

/**
 * Defaults double as the "healthy adult baseline" the wizard starts from —
 * every boolean/scale field already carries a plausible value, so a patient
 * is screening-eligible (all 21 features present) the moment the wizard
 * opens, not only once every field has been deliberately touched. The
 * original 3-step form let BMI stay blank and silently produced an
 * ineligible profile; requiring it here (see STEP_DEFS validation) closes
 * that gap rather than reproducing it.
 */
export const EMPTY_FORM: FormState = {
  pseudonym: '',
  age: '45',
  sex: 'female',
  bmi: '',
  gen_hlth: '2',
  ment_hlth: '0',
  phys_hlth: '0',
  education: '5',
  income: '6',
  high_bp: false,
  high_chol: false,
  chol_check: true,
  stroke: false,
  heart_disease_or_attack: false,
  diff_walk: false,
  smoker: false,
  phys_activity: true,
  fruits: true,
  veggies: true,
  hvy_alcohol_consump: false,
  any_healthcare: true,
  no_doc_bc_cost: false,
}

export type YesNoKey =
  | 'high_bp'
  | 'high_chol'
  | 'chol_check'
  | 'stroke'
  | 'heart_disease_or_attack'
  | 'diff_walk'
  | 'smoker'
  | 'phys_activity'
  | 'fruits'
  | 'veggies'
  | 'hvy_alcohol_consump'
  | 'any_healthcare'
  | 'no_doc_bc_cost'

export interface YesNoDef {
  key: YesNoKey
  label: string
  hint?: string
}

/** BRFSS GenHlth: 1 (best) – 5 (worst). Order shown matches survey order. */
export const GEN_HLTH_OPTIONS = [
  ['1', 'Excellent'],
  ['2', 'Very good'],
  ['3', 'Good'],
  ['4', 'Fair'],
  ['5', 'Poor'],
] as const

/** BRFSS EDUCA scale. */
export const EDUCATION_OPTIONS = [
  ['1', 'Never attended school / kindergarten only'],
  ['2', 'Elementary (grades 1–8)'],
  ['3', 'Some high school (grades 9–11)'],
  ['4', 'High school graduate or GED'],
  ['5', 'Some college or technical school'],
  ['6', 'College graduate'],
] as const

/** BRFSS INCOME2 scale. */
export const INCOME_OPTIONS = [
  ['1', 'Less than $10,000'],
  ['2', '$10,000–$14,999'],
  ['3', '$15,000–$19,999'],
  ['4', '$20,000–$24,999'],
  ['5', '$25,000–$34,999'],
  ['6', '$35,000–$49,999'],
  ['7', '$50,000–$74,999'],
  ['8', '$75,000 or more'],
] as const

export interface StepDef {
  id: string
  label: string
  short: string
  icon: LucideIcon
  description: string
  /** True for every step but Identity and Review — used to render the
      "Model-required baseline" badge honestly rather than on every step. */
  modelRequired: boolean
  fields: readonly YesNoKey[]
}

export const CARDIOMETABOLIC: readonly YesNoDef[] = [
  { key: 'high_bp', label: 'High blood pressure', hint: 'Ever told by a health professional' },
  { key: 'high_chol', label: 'High cholesterol', hint: 'Ever told by a health professional' },
  { key: 'chol_check', label: 'Cholesterol checked', hint: 'Within the past 5 years' },
  { key: 'stroke', label: 'History of stroke' },
  { key: 'heart_disease_or_attack', label: 'Coronary heart disease or heart attack' },
]

export const FUNCTIONAL_YESNO: readonly YesNoDef[] = [
  { key: 'diff_walk', label: 'Difficulty walking or climbing stairs', hint: 'Serious difficulty' },
]

export const LIFESTYLE: readonly YesNoDef[] = [
  { key: 'phys_activity', label: 'Physical activity', hint: 'In the past 30 days, not counting a job' },
  { key: 'fruits', label: 'Fruit consumption', hint: 'One or more times per day' },
  { key: 'veggies', label: 'Vegetable consumption', hint: 'One or more times per day' },
  { key: 'smoker', label: 'Smoking history', hint: 'Smoked at least 100 cigarettes, lifetime' },
  { key: 'hvy_alcohol_consump', label: 'Heavy alcohol consumption', hint: 'BRFSS heavy-drinking threshold' },
]

export const HEALTHCARE: readonly YesNoDef[] = [
  { key: 'any_healthcare', label: 'Has healthcare coverage', hint: 'Any kind — insurance, HMO, government plan' },
  {
    key: 'no_doc_bc_cost',
    label: 'Could not afford a doctor',
    hint: 'Needed to see one in the past 12 months but cost was a barrier',
  },
]

export const STEP_DEFS: StepDef[] = [
  {
    id: 'identity',
    label: 'Patient Identity',
    short: 'Identity',
    icon: IdCard,
    description: 'A workspace label plus the three baseline measurements the model reads directly.',
    modelRequired: false,
    fields: [],
  },
  {
    id: 'cardiometabolic',
    label: 'Cardiometabolic History',
    short: 'Cardiometabolic',
    icon: Heart,
    description: 'Conditions the BRFSS survey — and the trained model — treats as diabetes risk signals.',
    modelRequired: true,
    fields: CARDIOMETABOLIC.map((f) => f.key),
  },
  {
    id: 'functional',
    label: 'Functional Health',
    short: 'Functional',
    icon: Stethoscope,
    description: "Self-rated overall health and recent days of impaired function.",
    modelRequired: true,
    fields: FUNCTIONAL_YESNO.map((f) => f.key),
  },
  {
    id: 'lifestyle',
    label: 'Lifestyle',
    short: 'Lifestyle',
    icon: Salad,
    description: 'Activity, diet and substance-use signals from the same survey instrument.',
    modelRequired: true,
    fields: LIFESTYLE.map((f) => f.key),
  },
  {
    id: 'healthcare',
    label: 'Healthcare Access',
    short: 'Healthcare',
    icon: Activity,
    description: 'Coverage and affordability — both trained features, not just context.',
    modelRequired: true,
    fields: HEALTHCARE.map((f) => f.key),
  },
  {
    id: 'sociodemographic',
    label: 'Sociodemographic Context',
    short: 'Context',
    icon: Banknote,
    description:
      'Education and household income are part of the BRFSS feature set the model was trained on. ' +
      'They inform the statistical baseline only — neither implies a diagnosis.',
    modelRequired: true,
    fields: [],
  },
  {
    id: 'review',
    label: 'Review & Create',
    short: 'Review',
    icon: ClipboardCheck,
    description: 'Every field below — all 21 trained features plus the workspace label — before creating the twin.',
    modelRequired: false,
    fields: [],
  },
]

/**
 * Builds the exact `POST /api/patients` body. Field names and the 19-key
 * `baseline_measurements` dict are unchanged from the original form — only
 * the wizard presentation around this call is new. `age`/`sex` travel as
 * top-level fields (the backend derives its `Sex`/`Age`-bucket features
 * from the Patient row, not from `baseline_measurements`); every other one
 * of the 21 trained features is a `baseline_measurements` key.
 */
export const ALL_YESNO_DEFS: readonly YesNoDef[] = [...CARDIOMETABOLIC, ...FUNCTIONAL_YESNO, ...LIFESTYLE, ...HEALTHCARE]

/** The 19 keys `baseline_measurements` carries — every trained feature
    except `age`/`sex`, which travel as top-level Patient fields instead. */
export function buildMeasurements(form: FormState): Record<string, number> {
  const measurements: Record<string, number> = {}
  for (const { key } of ALL_YESNO_DEFS) measurements[key] = form[key] ? 1 : 0
  measurements.bmi = Number(form.bmi)
  measurements.gen_hlth = Number(form.gen_hlth)
  measurements.ment_hlth = Number(form.ment_hlth)
  measurements.phys_hlth = Number(form.phys_hlth)
  measurements.education = Number(form.education)
  measurements.income = Number(form.income)
  return measurements
}

export function buildPayload(form: FormState) {
  return {
    pseudonym: form.pseudonym.trim() || 'Unnamed patient',
    age: Number(form.age),
    sex: form.sex,
    baseline_measurements: buildMeasurements(form),
  }
}

/** Human label for every editable field — yes/no and scale alike. Shared
    by the review step and the diff/current-state displays so a field never
    reads differently in two places. */
export const FIELD_LABEL: Record<string, string> = {
  ...Object.fromEntries(ALL_YESNO_DEFS.map((d) => [d.key, d.label])),
  bmi: 'BMI',
  gen_hlth: 'General health',
  ment_hlth: 'Poor mental-health days',
  phys_hlth: 'Poor physical-health days',
  education: 'Education',
  income: 'Household income',
}

const SCALE_OPTIONS: Record<string, readonly (readonly [string, string])[]> = {
  gen_hlth: GEN_HLTH_OPTIONS,
  education: EDUCATION_OPTIONS,
  income: INCOME_OPTIONS,
}

/** Renders a stored value the way a person reads it: scale fields resolve
    to their survey label, yes/no fields to Yes/No, everything else as-is. */
export function formatFieldValue(key: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not recorded'
  const scale = SCALE_OPTIONS[key]
  if (scale) return scale.find(([v]) => v === String(value))?.[1] ?? String(value)
  if (ALL_YESNO_DEFS.some((d) => d.key === key)) return Number(value) ? 'Yes' : 'No'
  if (key === 'bmi') return String(value)
  if (key === 'ment_hlth' || key === 'phys_hlth') return `${value} of 30 days`
  return String(value)
}

/**
 * The 19 `baseline_measurements` keys, in the same order the backend's
 * `FEATURE_KEY_MAP` lists them — used to check completeness against a
 * materialized `current_state` dict without duplicating BRFSS-specific
 * logic beyond simple key presence.
 */
export const MEASUREMENT_KEYS: readonly string[] = [
  'high_bp', 'high_chol', 'chol_check', 'bmi', 'smoker', 'stroke',
  'heart_disease_or_attack', 'phys_activity', 'fruits', 'veggies',
  'hvy_alcohol_consump', 'any_healthcare', 'no_doc_bc_cost', 'gen_hlth',
  'ment_hlth', 'phys_hlth', 'diff_walk', 'education', 'income',
]

export interface Readiness {
  present: number
  total: number
  missing: string[]
  ready: boolean
}

/**
 * Mirrors `screening_agent.check_eligibility` closely enough to answer "is
 * this patient screening-ready" from data already on the page — sex needs
 * a trained encoding (female/male only) and every measurement key must be
 * present. This never invents a verdict the backend wouldn't reach; it
 * only reads presence of values the backend itself returned in
 * `current_state`.
 */
export function computeReadiness(state: Record<string, unknown> | undefined | null): Readiness {
  const s = state ?? {}
  const missing: string[] = []
  const sexOk = s.sex === 'female' || s.sex === 'male'
  if (!sexOk) missing.push('sex')
  if (s.age === undefined || s.age === null) missing.push('age')
  for (const key of MEASUREMENT_KEYS) {
    if (s[key] === undefined || s[key] === null) missing.push(key)
  }
  const total = MODEL_FEATURE_COUNT
  return { present: total - missing.length, total, missing, ready: missing.length === 0 }
}

/**
 * Pre-populates the wizard's form state from a patient's materialized
 * `current_state` for edit mode. A field genuinely absent from
 * `current_state` (an incomplete profile, e.g. the seeded "incomplete
 * history" demo) falls back to the same default the create flow starts
 * from — the UI has to show *something* in a Yes/No toggle — but that
 * fallback is never treated as a real prior value: `buildMeasurementDiff`
 * below compares against the raw `current_state`, not this form, so a
 * defaulted-but-never-touched field is never reported as "changed".
 */
export function formFromState(
  state: Record<string, unknown> | undefined | null,
  identity: { pseudonym: string; age: number; sex: string },
): FormState {
  const s = state ?? {}
  const str = (key: keyof FormState, fallback: string) =>
    s[key] === undefined || s[key] === null ? fallback : String(s[key])
  const bool = (key: YesNoKey, fallback: boolean) =>
    s[key] === undefined || s[key] === null ? fallback : Boolean(Number(s[key]))

  return {
    pseudonym: identity.pseudonym,
    age: String(identity.age),
    sex: identity.sex,
    bmi: s.bmi === undefined || s.bmi === null ? '' : String(s.bmi),
    gen_hlth: str('gen_hlth', EMPTY_FORM.gen_hlth),
    ment_hlth: str('ment_hlth', EMPTY_FORM.ment_hlth),
    phys_hlth: str('phys_hlth', EMPTY_FORM.phys_hlth),
    education: str('education', EMPTY_FORM.education),
    income: str('income', EMPTY_FORM.income),
    high_bp: bool('high_bp', EMPTY_FORM.high_bp),
    high_chol: bool('high_chol', EMPTY_FORM.high_chol),
    chol_check: bool('chol_check', EMPTY_FORM.chol_check),
    stroke: bool('stroke', EMPTY_FORM.stroke),
    heart_disease_or_attack: bool('heart_disease_or_attack', EMPTY_FORM.heart_disease_or_attack),
    diff_walk: bool('diff_walk', EMPTY_FORM.diff_walk),
    smoker: bool('smoker', EMPTY_FORM.smoker),
    phys_activity: bool('phys_activity', EMPTY_FORM.phys_activity),
    fruits: bool('fruits', EMPTY_FORM.fruits),
    veggies: bool('veggies', EMPTY_FORM.veggies),
    hvy_alcohol_consump: bool('hvy_alcohol_consump', EMPTY_FORM.hvy_alcohol_consump),
    any_healthcare: bool('any_healthcare', EMPTY_FORM.any_healthcare),
    no_doc_bc_cost: bool('no_doc_bc_cost', EMPTY_FORM.no_doc_bc_cost),
  }
}

export interface MeasurementChange {
  key: string
  label: string
  from: string
  to: string
  /** True when the key was absent from `current_state` entirely — a
      first-time recording, not a revision of a prior value. */
  isNew: boolean
}

/**
 * The event-sourcing core of edit mode: compares the form's current values
 * against the patient's real `current_state` and returns ONLY what
 * differs. This — not a full resend of all 19 fields — is what gets
 * written as the new timeline event, so the event log stays a meaningful
 * record of what actually changed rather than noise. Numeric comparison
 * (not string) so "1" from the backend and 1 from a freshly-toggled
 * checkbox compare equal.
 */
export function buildMeasurementDiff(
  form: FormState,
  initialState: Record<string, unknown> | undefined | null,
): MeasurementChange[] {
  const s = initialState ?? {}
  const next = buildMeasurements(form)
  const changes: MeasurementChange[] = []
  for (const key of MEASUREMENT_KEYS) {
    const prior = s[key]
    const isNew = prior === undefined || prior === null
    if (!isNew && Number(prior) === next[key]) continue
    changes.push({
      key,
      label: FIELD_LABEL[key] ?? key,
      from: isNew ? 'Not recorded' : formatFieldValue(key, prior),
      to: formatFieldValue(key, next[key]),
      isNew,
    })
  }
  return changes
}

/** Only the changed/newly-recorded keys — this is the payload posted to
    `POST /api/twin/{id}/events`, never a full duplicate of unchanged data. */
export function buildMeasurementDelta(changes: MeasurementChange[], form: FormState): Record<string, number> {
  const full = buildMeasurements(form)
  const delta: Record<string, number> = {}
  for (const c of changes) delta[c.key] = full[c.key]
  return delta
}

/** Step 1 is the only gate: every later step already carries a valid
    default, so nothing else can block Continue. BMI is required here
    precisely because the old form let it stay blank and silently produced
    a non-screening-eligible patient — the thing this rebuild exists to fix. */
export function identityStepErrors(form: FormState): string[] {
  const errors: string[] = []
  const age = Number(form.age)
  if (!form.age.trim() || Number.isNaN(age) || age < 0 || age > 120) {
    errors.push('Age must be between 0 and 120.')
  }
  const bmi = Number(form.bmi)
  if (!form.bmi.trim() || Number.isNaN(bmi) || bmi <= 0 || bmi > 100) {
    errors.push('BMI is required and must be a positive number.')
  }
  return errors
}

/** Only "female"/"male" have a trained encoding (screening_agent.SEX_TO_CODE).
    Other selections are still valid Patient records — the model simply
    cannot score them, exactly like a missing measurement. */
export const SEX_OPTIONS = [
  ['female', 'Female', true],
  ['male', 'Male', true],
  ['other', 'Other', false],
  ['unspecified', 'Unspecified', false],
] as const
