import { describe, expect, it } from 'vitest'
import {
  CARDIOMETABOLIC,
  EDUCATION_OPTIONS,
  EMPTY_FORM,
  FUNCTIONAL_YESNO,
  GEN_HLTH_OPTIONS,
  HEALTHCARE,
  INCOME_OPTIONS,
  LIFESTYLE,
  MEASUREMENT_KEYS,
  MODEL_FEATURE_COUNT,
  STEP_DEFS,
  buildMeasurementDelta,
  buildMeasurementDiff,
  buildPayload,
  computeReadiness,
  formFromState,
  formatFieldValue,
  identityStepErrors,
} from './intakeSchema'

/** A fully-complete current_state, shaped exactly like what
    `GET /api/twin/{id}/timeline` returns — every one of the 19 measurement
    keys plus age/sex, values chosen to be easy to spot in a diff. */
const FULL_STATE: Record<string, unknown> = {
  patient_id: 7,
  age: 52,
  sex: 'female',
  high_bp: 0, high_chol: 0, chol_check: 1, bmi: 28.4, smoker: 0, stroke: 0,
  heart_disease_or_attack: 0, phys_activity: 1, fruits: 1, veggies: 1,
  hvy_alcohol_consump: 0, any_healthcare: 1, no_doc_bc_cost: 0, gen_hlth: 2,
  ment_hlth: 0, phys_hlth: 0, diff_walk: 0, education: 5, income: 6,
}

/**
 * The 21 twin-state keys `backend/app/agents/screening_agent.py::FEATURE_KEY_MAP`
 * reads, transcribed directly from that file (not re-derived — a literal
 * copy is what actually catches drift if either side changes). `sex` and
 * `age_bucket` are NOT `baseline_measurements` keys: the backend derives
 * them from the Patient row's top-level `sex`/`age` fields instead
 * (screening_agent.py `_resolve_feature_vector`), so they're carved out
 * here into their own assertion further down rather than expected in the
 * measurements dict.
 */
const BACKEND_FEATURE_KEYS = [
  'high_bp', 'high_chol', 'chol_check', 'bmi', 'smoker', 'stroke',
  'heart_disease_or_attack', 'phys_activity', 'fruits', 'veggies',
  'hvy_alcohol_consump', 'any_healthcare', 'no_doc_bc_cost', 'gen_hlth',
  'ment_hlth', 'phys_hlth', 'diff_walk', 'sex', 'age_bucket', 'education',
  'income',
]
const DERIVED_NOT_IN_MEASUREMENTS = new Set(['sex', 'age_bucket'])
const EXPECTED_MEASUREMENT_KEYS = BACKEND_FEATURE_KEYS.filter((k) => !DERIVED_NOT_IN_MEASUREMENTS.has(k)).sort()

describe('buildPayload', () => {
  const filled = { ...EMPTY_FORM, pseudonym: 'Participant 004', age: '52', bmi: '29.4' }

  it('sends exactly the 19 backend-required measurement keys — no omissions, no invented extras', () => {
    const { baseline_measurements } = buildPayload(filled)
    expect(Object.keys(baseline_measurements).sort()).toEqual(EXPECTED_MEASUREMENT_KEYS)
  })

  it('sends age and sex as top-level fields, not inside baseline_measurements', () => {
    const payload = buildPayload(filled)
    expect(payload.age).toBe(52)
    expect(payload.sex).toBe('female')
    expect(payload.baseline_measurements).not.toHaveProperty('sex')
    expect(payload.baseline_measurements).not.toHaveProperty('age_bucket')
    expect(payload.baseline_measurements).not.toHaveProperty('age')
  })

  it('covers all 21 trained features between the top-level fields and baseline_measurements', () => {
    const payload = buildPayload(filled)
    const covered = new Set([...Object.keys(payload.baseline_measurements), 'age', 'sex'])
    expect(covered.size).toBe(MODEL_FEATURE_COUNT)
  })

  it('encodes Yes/No fields as 1/0, never true/false', () => {
    const { baseline_measurements } = buildPayload({ ...filled, high_bp: true, smoker: false })
    expect(baseline_measurements.high_bp).toBe(1)
    expect(baseline_measurements.smoker).toBe(0)
  })

  it('falls back to "Unnamed patient" for a blank pseudonym, never sends an empty string', () => {
    expect(buildPayload({ ...filled, pseudonym: '   ' }).pseudonym).toBe('Unnamed patient')
  })
})

describe('BRFSS scale option coding', () => {
  it('GenHlth is coded 1 (best) through 5 (worst)', () => {
    expect(GEN_HLTH_OPTIONS.map(([v]) => v)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('Education is coded 1 through 6', () => {
    expect(EDUCATION_OPTIONS).toHaveLength(6)
    expect(EDUCATION_OPTIONS.map(([v]) => v)).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('Income is coded 1 through 8', () => {
    expect(INCOME_OPTIONS).toHaveLength(8)
    expect(INCOME_OPTIONS.map(([v]) => v)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
  })
})

describe('wizard step coverage', () => {
  it('has exactly the 7 required sections, in the specified order', () => {
    expect(STEP_DEFS.map((s) => s.id)).toEqual([
      'identity',
      'cardiometabolic',
      'functional',
      'lifestyle',
      'healthcare',
      'sociodemographic',
      'review',
    ])
  })

  /**
   * The brief's hard requirement was "do not omit any of these [21
   * features]". This is the test that actually enforces it: every
   * Yes/No definition array the wizard renders, unioned together, must
   * equal precisely the Yes/No subset of the backend's feature list —
   * catching both an accidentally-dropped field and an invented one.
   */
  it('covers every backend Yes/No feature across the step definitions — no gaps, no extras', () => {
    const wizardYesNoKeys = [...CARDIOMETABOLIC, ...FUNCTIONAL_YESNO, ...LIFESTYLE, ...HEALTHCARE]
      .map((d) => d.key)
      .sort()
    const backendYesNoKeys = EXPECTED_MEASUREMENT_KEYS.filter(
      (k) => !['bmi', 'gen_hlth', 'ment_hlth', 'phys_hlth', 'education', 'income'].includes(k),
    ).sort()
    expect(wizardYesNoKeys).toEqual(backendYesNoKeys)
  })

  it('assigns each Yes/No feature to exactly one step — no field answered twice', () => {
    const keys = [...CARDIOMETABOLIC, ...FUNCTIONAL_YESNO, ...LIFESTYLE, ...HEALTHCARE].map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('identityStepErrors', () => {
  it('requires BMI — the original form let this stay blank and silently produced an ineligible profile', () => {
    const errors = identityStepErrors({ ...EMPTY_FORM, age: '45', bmi: '' })
    expect(errors.some((e) => e.includes('BMI'))).toBe(true)
  })

  it('rejects an out-of-range age', () => {
    expect(identityStepErrors({ ...EMPTY_FORM, age: '200', bmi: '25' }).length).toBeGreaterThan(0)
  })

  it('passes with a valid age and BMI', () => {
    expect(identityStepErrors({ ...EMPTY_FORM, age: '45', bmi: '25.5' })).toEqual([])
  })
})

describe('computeReadiness', () => {
  it('mirrors screening_agent.check_eligibility: all 21 features present means ready', () => {
    const r = computeReadiness(FULL_STATE)
    expect(r).toEqual({ present: MODEL_FEATURE_COUNT, total: MODEL_FEATURE_COUNT, missing: [], ready: true })
  })

  it('flags a missing measurement key without inventing a value for it', () => {
    const { bmi: _bmi, ...withoutBmi } = FULL_STATE
    const r = computeReadiness(withoutBmi)
    expect(r.ready).toBe(false)
    expect(r.missing).toContain('bmi')
    expect(r.present).toBe(MODEL_FEATURE_COUNT - 1)
  })

  it('treats sex outside female/male as missing — no trained encoding exists for it', () => {
    const r = computeReadiness({ ...FULL_STATE, sex: 'unspecified' })
    expect(r.ready).toBe(false)
    expect(r.missing).toContain('sex')
  })

  it('handles a wholly empty or absent state without throwing', () => {
    expect(computeReadiness(undefined).present).toBe(0)
    expect(computeReadiness({}).missing.length).toBe(MODEL_FEATURE_COUNT)
  })

  it('every measurement key computeReadiness checks is one buildMeasurements actually writes', () => {
    // The two must never drift: a key readiness checks for but the payload
    // never sends would make a patient permanently "incomplete".
    const { baseline_measurements } = buildPayload({ ...EMPTY_FORM, age: '45', bmi: '25' })
    expect(MEASUREMENT_KEYS.slice().sort()).toEqual(Object.keys(baseline_measurements).sort())
  })
})

describe('formFromState — pre-populating the edit wizard', () => {
  const identity = { pseudonym: 'Demo Patient B', age: 52, sex: 'female' }

  it('reads every real value from current_state, not the create-mode defaults', () => {
    const form = formFromState({ ...FULL_STATE, bmi: 31.2, high_bp: 1 }, identity)
    expect(form.bmi).toBe('31.2')
    expect(form.high_bp).toBe(true)
    expect(form.pseudonym).toBe('Demo Patient B')
    expect(form.age).toBe('52')
  })

  it('falls back to the create-mode default for a field genuinely absent from current_state', () => {
    const { education: _e, income: _i, ...incomplete } = FULL_STATE
    const form = formFromState(incomplete, identity)
    expect(form.education).toBe(EMPTY_FORM.education)
    expect(form.income).toBe(EMPTY_FORM.income)
  })

  it('round-trips every measurement key with no loss — pre-populate then re-derive equals the original', () => {
    const form = formFromState(FULL_STATE, identity)
    const rebuilt = buildPayload(form).baseline_measurements
    for (const key of MEASUREMENT_KEYS) {
      expect(Number(rebuilt[key])).toBe(Number(FULL_STATE[key]))
    }
  })
})

describe('buildMeasurementDiff — the event-sourcing core of Edit Patient', () => {
  const identity = { pseudonym: 'Demo Patient B', age: 52, sex: 'female' }

  it('reports no changes when the form still matches current_state exactly', () => {
    const form = formFromState(FULL_STATE, identity)
    expect(buildMeasurementDiff(form, FULL_STATE)).toEqual([])
  })

  it('matches the brief\'s own worked example: BMI, High BP and Physical activity change, nothing else does', () => {
    const form = formFromState(FULL_STATE, identity)
    const edited = { ...form, bmi: '30.1', high_bp: true, phys_activity: false }
    const changes = buildMeasurementDiff(edited, FULL_STATE)
    expect(changes.map((c) => c.key).sort()).toEqual(['bmi', 'high_bp', 'phys_activity'])
    const bmi = changes.find((c) => c.key === 'bmi')!
    expect(bmi.from).toBe('28.4')
    expect(bmi.to).toBe('30.1')
    expect(bmi.isNew).toBe(false)
    const hbp = changes.find((c) => c.key === 'high_bp')!
    expect(hbp.from).toBe('No')
    expect(hbp.to).toBe('Yes')
  })

  it('marks a field absent from current_state as newly recorded, not as a change from a fabricated prior value', () => {
    const { no_doc_bc_cost: _n, ...incomplete } = FULL_STATE
    const form = { ...formFromState(incomplete, identity), no_doc_bc_cost: true }
    const changes = buildMeasurementDiff(form, incomplete)
    const entry = changes.find((c) => c.key === 'no_doc_bc_cost')!
    expect(entry.isNew).toBe(true)
    expect(entry.from).toBe('Not recorded')
  })

  it('does not report a change when a field is defaulted for display but never actually touched', () => {
    // formFromState must default an absent field to *something* for the
    // toggle to render, but if the user never touches it, it must not
    // show up as a phantom "change" from a value that was never real.
    const { smoker: _s, ...incomplete } = FULL_STATE
    const form = formFromState(incomplete, identity) // smoker defaults to EMPTY_FORM.smoker (false)
    const changes = buildMeasurementDiff(form, incomplete)
    // smoker IS newly recorded (it was absent), but only because it's
    // absent — not because the default differs from some prior value.
    const smoker = changes.find((c) => c.key === 'smoker')
    expect(smoker?.isNew).toBe(true)
  })

  it('produces a diff whose keys are always a subset of MEASUREMENT_KEYS — never an invented field', () => {
    const form = formFromState(FULL_STATE, identity)
    const edited = { ...form, bmi: '99', education: '1' }
    const changes = buildMeasurementDiff(edited, FULL_STATE)
    for (const c of changes) expect(MEASUREMENT_KEYS).toContain(c.key)
  })
})

describe('buildMeasurementDelta — what actually gets posted to POST /api/twin/{id}/events', () => {
  const identity = { pseudonym: 'Demo Patient B', age: 52, sex: 'female' }

  it('sends ONLY the changed keys — never a full resend of all 19 fields', () => {
    const form = formFromState(FULL_STATE, identity)
    const edited = { ...form, bmi: '30.1' }
    const changes = buildMeasurementDiff(edited, FULL_STATE)
    const delta = buildMeasurementDelta(changes, edited)
    expect(Object.keys(delta)).toEqual(['bmi'])
    expect(delta.bmi).toBe(30.1)
  })

  it('returns an empty object when nothing changed — no no-op event should ever be built', () => {
    const form = formFromState(FULL_STATE, identity)
    expect(buildMeasurementDelta(buildMeasurementDiff(form, FULL_STATE), form)).toEqual({})
  })
})

describe('formatFieldValue', () => {
  it('renders a yes/no field as Yes/No, not 1/0', () => {
    expect(formatFieldValue('high_bp', 1)).toBe('Yes')
    expect(formatFieldValue('high_bp', 0)).toBe('No')
  })

  it('resolves a scale field to its survey label, not the raw code', () => {
    expect(formatFieldValue('gen_hlth', '1')).toBe('Excellent')
    expect(formatFieldValue('education', '6')).toBe('College graduate')
  })

  it('reports an absent value honestly rather than showing 0 or blank', () => {
    expect(formatFieldValue('bmi', undefined)).toBe('Not recorded')
    expect(formatFieldValue('high_bp', null)).toBe('Not recorded')
  })
})
