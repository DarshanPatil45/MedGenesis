import { describe, expect, it } from 'vitest'
import type { TimelineEvent } from '../../api/types'
import { buildDiabetesStatusPayload, buildDiabetesSymptomPayload } from './diabetesModel'
import { buildTimelineEntries } from './timelineDiff'

function evt(id: number, event_type: string, payload: Record<string, unknown>, recorded_at: string): TimelineEvent {
  return { id, patient_id: 1, event_type, payload, source: 'real', recorded_at }
}

describe('buildTimelineEntries', () => {
  it('matches the brief\'s own example: a weight reading followed by a new one shows the real prior value', () => {
    const events = [
      evt(1, 'lab_result', { test_name: 'Weight', value: 82.4, unit: 'kg' }, '2026-03-10T00:00:00Z'),
      evt(2, 'lab_result', { test_name: 'Weight', value: 81.7, unit: 'kg' }, '2026-09-09T00:00:00Z'),
    ]
    const entries = buildTimelineEntries(events)
    expect(entries).toHaveLength(2)
    // Newest first.
    expect(entries[0].changes[0]).toEqual({ label: 'Weight', from: '82.4 kg', to: '81.7 kg' })
    // The first-ever reading has no prior value — never fabricated as 0 or a guess.
    expect(entries[1].changes[0]).toEqual({ label: 'Weight', from: null, to: '82.4 kg' })
  })

  it('tracks each lab test independently — a BP reading never appears as a Weight change', () => {
    const events = [
      evt(1, 'lab_result', { test_name: 'Weight', value: 80, unit: 'kg' }, '2026-01-01T00:00:00Z'),
      evt(2, 'lab_result', { test_name: 'Blood Pressure (Systolic)', value: 132, unit: 'mmHg' }, '2026-01-02T00:00:00Z'),
      evt(3, 'lab_result', { test_name: 'Weight', value: 79, unit: 'kg' }, '2026-01-03T00:00:00Z'),
    ]
    const entries = buildTimelineEntries(events)
    const weightEntry = entries.find((e) => e.changes[0]?.label === 'Weight' && e.changes[0]?.to === '79 kg')!
    expect(weightEntry.changes[0].from).toBe('80 kg') // not influenced by the BP reading in between
  })

  it('reads events out of order correctly — sorts internally rather than trusting array order', () => {
    const events = [
      evt(2, 'lab_result', { test_name: 'Weight', value: 81.7, unit: 'kg' }, '2026-09-09T00:00:00Z'),
      evt(1, 'lab_result', { test_name: 'Weight', value: 82.4, unit: 'kg' }, '2026-03-10T00:00:00Z'),
    ]
    const entries = buildTimelineEntries(events)
    expect(entries[0].id).toBe(2) // newest first in output
    expect(entries[0].changes[0].from).toBe('82.4 kg') // correctly the earlier reading
  })

  it('formats a measurement event\'s changed keys using the real BRFSS labels/values', () => {
    const events = [
      evt(1, 'measurement', { high_bp: 0 }, '2026-01-01T00:00:00Z'),
      evt(2, 'measurement', { high_bp: 1 }, '2026-02-01T00:00:00Z'),
    ]
    const entries = buildTimelineEntries(events)
    expect(entries[0].changes[0]).toEqual({ label: 'High blood pressure', from: 'No', to: 'Yes' })
  })

  it('a measurement event with multiple changed keys reports each independently', () => {
    const events = [
      evt(1, 'measurement', { bmi: 28.4, high_bp: 0 }, '2026-01-01T00:00:00Z'),
      evt(2, 'measurement', { bmi: 30.1, high_bp: 1 }, '2026-09-16T00:00:00Z'),
    ]
    const entries = buildTimelineEntries(events)
    expect(entries[0].changes).toHaveLength(2)
    expect(entries[0].changes.find((c) => c.label === 'BMI')).toEqual({ label: 'BMI', from: '28.4', to: '30.1' })
  })

  it('labels a medication_change event with the medication name and action', () => {
    const events = [evt(1, 'medication_change', { medication_name: 'Metformin', action: 'started', dose: '500mg daily' }, '2026-01-01T00:00:00Z')]
    const entries = buildTimelineEntries(events)
    expect(entries[0].changes[0].label).toContain('Metformin')
    expect(entries[0].changes[0].label).toContain('started')
  })

  it('collapses repeated screening runs with an unchanged tier — no new information, no entry', () => {
    const events = [
      evt(1, 'screening', { status: 'scored', risk_tier: 'Moderate' }, '2026-01-01T00:00:00Z'),
      evt(2, 'screening', { status: 'scored', risk_tier: 'Moderate' }, '2026-01-02T00:00:00Z'),
      evt(3, 'screening', { status: 'scored', risk_tier: 'Moderate' }, '2026-01-03T00:00:00Z'),
    ]
    const entries = buildTimelineEntries(events)
    expect(entries).toHaveLength(1) // only the first-ever run is shown
    expect(entries[0].id).toBe(1)
  })

  it('shows an explicit risk-tier diff when a re-run screening actually changes tier', () => {
    const events = [
      evt(1, 'screening', { status: 'scored', risk_tier: 'Low' }, '2026-01-01T00:00:00Z'),
      evt(2, 'screening', { status: 'scored', risk_tier: 'Moderate' }, '2026-06-01T00:00:00Z'),
    ]
    const entries = buildTimelineEntries(events)
    expect(entries).toHaveLength(2)
    expect(entries[0].changes[0]).toEqual({ label: 'Risk tier', from: 'Low', to: 'Moderate' })
  })

  it('collapses repeated care_plan runs with an unchanged tier the same way as screening', () => {
    const events = [
      evt(1, 'care_plan', { risk_tier: 'Moderate', follow_up_weeks: 12 }, '2026-01-01T00:00:00Z'),
      evt(2, 'care_plan', { risk_tier: 'Moderate', follow_up_weeks: 12 }, '2026-01-02T00:00:00Z'),
    ]
    const entries = buildTimelineEntries(events)
    expect(entries).toHaveLength(1)
  })

  it('does not collapse repeated declined-to-score screening runs into nothing — the first still shows', () => {
    const events = [
      evt(1, 'screening', { status: 'unavailable_for_profile', risk_tier: null }, '2026-01-01T00:00:00Z'),
      evt(2, 'screening', { status: 'unavailable_for_profile', risk_tier: null }, '2026-01-02T00:00:00Z'),
    ]
    const entries = buildTimelineEntries(events)
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe(1)
  })

  it('screening and care_plan track their own outcome independently', () => {
    const events = [
      evt(1, 'screening', { status: 'scored', risk_tier: 'Moderate' }, '2026-01-01T00:00:00Z'),
      evt(2, 'care_plan', { risk_tier: 'Moderate', follow_up_weeks: 12 }, '2026-01-02T00:00:00Z'),
    ]
    const entries = buildTimelineEntries(events)
    // Both are first-ever runs of their own type, so both show, even
    // though the tier value happens to match.
    expect(entries).toHaveLength(2)
  })

  it('shows a diabetes status change as a labeled diff, not a generic note', () => {
    const events = [
      evt(1, 'note', buildDiabetesStatusPayload('not_diagnosed'), '2026-01-01T00:00:00Z'),
      evt(2, 'note', buildDiabetesStatusPayload('prediabetes'), '2026-06-01T00:00:00Z'),
    ]
    const entries = buildTimelineEntries(events)
    expect(entries).toHaveLength(2)
    expect(entries[0].summary).toBeUndefined()
    expect(entries[0].changes[0]).toEqual({ label: 'Diabetes status', from: 'Not diagnosed', to: 'Prediabetes' })
    expect(entries[1].changes[0]).toEqual({ label: 'Diabetes status', from: null, to: 'Not diagnosed' })
  })

  it('collapses a repeated, unchanged diabetes status into no new entry', () => {
    const events = [
      evt(1, 'note', buildDiabetesStatusPayload('diagnosed'), '2026-01-01T00:00:00Z'),
      evt(2, 'note', buildDiabetesStatusPayload('diagnosed'), '2026-06-01T00:00:00Z'),
    ]
    expect(buildTimelineEntries(events)).toHaveLength(1)
  })

  it('tracks each diabetes symptom independently and labels it by name', () => {
    const events = [
      evt(1, 'note', buildDiabetesSymptomPayload('excessive_thirst', 'unknown'), '2026-01-01T00:00:00Z'),
      evt(2, 'note', buildDiabetesSymptomPayload('frequent_urination', 'no'), '2026-01-02T00:00:00Z'),
      evt(3, 'note', buildDiabetesSymptomPayload('excessive_thirst', 'yes'), '2026-03-01T00:00:00Z'),
    ]
    const entries = buildTimelineEntries(events)
    expect(entries).toHaveLength(3)
    const latestThirst = entries.find((e) => e.id === 3)!
    expect(latestThirst.changes[0]).toEqual({ label: 'Excessive thirst', from: 'Unknown', to: 'Yes' })
    const urination = entries.find((e) => e.id === 2)!
    expect(urination.changes[0]).toEqual({ label: 'Frequent urination', from: null, to: 'No' })
  })

  it('does not let a free-text note with an empty payload.text collide with structured diabetes notes', () => {
    const events = [
      evt(1, 'note', { text: '' }, '2026-01-01T00:00:00Z'),
      evt(2, 'note', buildDiabetesStatusPayload('unknown'), '2026-01-02T00:00:00Z'),
    ]
    const entries = buildTimelineEntries(events)
    const freeTextEntry = entries.find((e) => e.id === 1)!
    const diabetesEntry = entries.find((e) => e.id === 2)!
    expect(freeTextEntry.summary).toBe('Note: ')
    expect(diabetesEntry.summary).toBeUndefined()
    expect(diabetesEntry.changes[0].label).toBe('Diabetes status')
  })

  it('gives screening/care_plan/chat/note events a summary line, not a field diff', () => {
    const events = [
      evt(1, 'screening', { risk_tier: 'Moderate' }, '2026-01-01T00:00:00Z'),
      evt(2, 'note', { text: 'Patient reports mild dizziness' }, '2026-01-02T00:00:00Z'),
    ]
    const entries = buildTimelineEntries(events)
    expect(entries.find((e) => e.eventType === 'screening')!.summary).toContain('Moderate')
    expect(entries.find((e) => e.eventType === 'note')!.summary).toContain('dizziness')
  })

  it('returns newest-first order', () => {
    const events = [
      evt(1, 'note', { text: 'old' }, '2026-01-01T00:00:00Z'),
      evt(2, 'note', { text: 'new' }, '2026-06-01T00:00:00Z'),
    ]
    const entries = buildTimelineEntries(events)
    expect(entries[0].id).toBe(2)
    expect(entries[1].id).toBe(1)
  })
})
