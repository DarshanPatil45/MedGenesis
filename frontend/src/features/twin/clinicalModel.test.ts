import { describe, expect, it } from 'vitest'
import type { LabRecord } from '../../api/types'
import {
  LAB_TEST,
  buildFeatureMapping,
  deriveBmi,
  deriveCholCheck,
  deriveHvyAlcohol,
  derivePhysActivity,
  deriveServingsFlag,
  deriveSmokerFromStatus,
} from './clinicalModel'

describe('deriveBmi', () => {
  it('computes the exact BMI formula: kg / m²', () => {
    // A textbook reference point: 70kg at 175cm = 22.9 (WHO example range).
    expect(deriveBmi(175, 70)).toBeCloseTo(22.9, 1)
  })

  it('matches a known synthetic profile exactly (moderate_risk: 1.65m, 79kg)', () => {
    // backend/app/ml/synthetic_patients.py DEMO_PROFILES.moderate_risk
    // records bmi: 29.0 directly — this derivation must agree with it.
    expect(deriveBmi(165, 79)).toBeCloseTo(29.0, 1)
  })

  it('returns null rather than a nonsensical value for zero or negative input', () => {
    expect(deriveBmi(0, 70)).toBeNull()
    expect(deriveBmi(175, 0)).toBeNull()
    expect(deriveBmi(-175, 70)).toBeNull()
  })
})

describe('deriveHvyAlcohol — CDC/BRFSS heavy-drinking threshold', () => {
  it('flags a man above 14 drinks/week, not at or below it', () => {
    expect(deriveHvyAlcohol(15, 'male')).toBe(1)
    expect(deriveHvyAlcohol(14, 'male')).toBe(0)
    expect(deriveHvyAlcohol(0, 'male')).toBe(0)
  })

  it('flags a woman above 7 drinks/week, not at or below it', () => {
    expect(deriveHvyAlcohol(8, 'female')).toBe(1)
    expect(deriveHvyAlcohol(7, 'female')).toBe(0)
  })

  it('refuses to apply a sex-specific threshold without a scored sex — never guesses', () => {
    expect(deriveHvyAlcohol(20, 'other')).toBeNull()
    expect(deriveHvyAlcohol(20, 'unspecified')).toBeNull()
  })
})

describe('derivePhysActivity — any activity in the past 30 days', () => {
  it('any nonzero frequency answers the BRFSS question directly', () => {
    expect(derivePhysActivity(1)).toBe(1)
    expect(derivePhysActivity(7)).toBe(1)
    expect(derivePhysActivity(0)).toBe(0)
  })
})

describe('deriveServingsFlag — one-or-more-per-day', () => {
  it('exactly matches the BRFSS ≥1/day threshold', () => {
    expect(deriveServingsFlag(1)).toBe(1)
    expect(deriveServingsFlag(0.5)).toBe(0)
    expect(deriveServingsFlag(3)).toBe(1)
  })
})

describe('deriveSmokerFromStatus', () => {
  it('never-smoker maps exactly to No — no approximation involved', () => {
    expect(deriveSmokerFromStatus('never')).toBe(0)
  })

  it('former and current both map to Yes (documented approximation, not hidden)', () => {
    expect(deriveSmokerFromStatus('former')).toBe(1)
    expect(deriveSmokerFromStatus('current')).toBe(1)
  })
})

describe('deriveCholCheck — a recorded lab within 5 years', () => {
  const now = new Date('2026-09-16T00:00:00Z')

  it('finds a cholesterol lab recorded within the window', () => {
    const labs: LabRecord[] = [{ test_name: 'Total Cholesterol', value: 190, recorded_at: '2024-01-01T00:00:00Z' }]
    expect(deriveCholCheck(labs, now)).toBe(1)
  })

  it('matches "lipid panel" too, not only the literal word "cholesterol"', () => {
    const labs: LabRecord[] = [{ test_name: 'Lipid Panel — LDL', value: 100, recorded_at: '2025-01-01T00:00:00Z' }]
    expect(deriveCholCheck(labs, now)).toBe(1)
  })

  it('does not count a cholesterol lab older than 5 years', () => {
    const labs: LabRecord[] = [{ test_name: 'Total Cholesterol', value: 190, recorded_at: '2019-01-01T00:00:00Z' }]
    expect(deriveCholCheck(labs, now)).toBe(0)
  })

  it('does not count an unrelated lab (e.g. HbA1c) as a cholesterol check', () => {
    const labs: LabRecord[] = [{ test_name: 'HbA1c', value: 7.2, recorded_at: '2026-01-01T00:00:00Z' }]
    expect(deriveCholCheck(labs, now)).toBe(0)
  })

  it('returns null (not 0) when there is no lab history at all — "no data" is not "checked: no"', () => {
    expect(deriveCholCheck([], now)).toBeNull()
  })
})

describe('LAB_TEST canonical names', () => {
  it('height and weight have distinct, stable test names entry/display can agree on', () => {
    expect(LAB_TEST.HEIGHT).toBe('Height')
    expect(LAB_TEST.WEIGHT).toBe('Weight')
    expect(LAB_TEST.BP_SYSTOLIC).not.toBe(LAB_TEST.BP_DIASTOLIC)
  })
})

describe('buildFeatureMapping', () => {
  it('reports exactly 21 rows — sex, age, and the 19 measurement keys', () => {
    expect(buildFeatureMapping({})).toHaveLength(21)
  })

  it('marks every field present when given a fully complete state', () => {
    const full = {
      sex: 'female', age: 52,
      high_bp: 0, high_chol: 0, chol_check: 1, bmi: 28.4, smoker: 0, stroke: 0,
      heart_disease_or_attack: 0, phys_activity: 1, fruits: 1, veggies: 1,
      hvy_alcohol_consump: 0, any_healthcare: 1, no_doc_bc_cost: 0, gen_hlth: 2,
      ment_hlth: 0, phys_hlth: 0, diff_walk: 0, education: 5, income: 6,
    }
    const rows = buildFeatureMapping(full)
    expect(rows.every((r) => r.present)).toBe(true)
  })

  it('names a concrete derivation path for a missing feature that has one', () => {
    const rows = buildFeatureMapping({ sex: 'female', age: 52 }) // bmi absent
    const bmiRow = rows.find((r) => r.key === 'bmi')!
    expect(bmiRow.present).toBe(false)
    expect(bmiRow.derivableFrom).toMatch(/Height/)
  })

  it('names no derivation path for a diagnosis-history field that has none', () => {
    const rows = buildFeatureMapping({ sex: 'female', age: 52 }) // high_bp absent
    const hbpRow = rows.find((r) => r.key === 'high_bp')!
    expect(hbpRow.present).toBe(false)
    expect(hbpRow.derivableFrom).toBeUndefined()
  })

  it('treats an unscored sex as missing, matching check_eligibility exactly', () => {
    const rows = buildFeatureMapping({ sex: 'unspecified', age: 52 })
    expect(rows.find((r) => r.key === 'sex')!.present).toBe(false)
  })
})
