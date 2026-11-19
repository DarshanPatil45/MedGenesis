import { describe, expect, it } from 'vitest'
import type { TimelineEvent } from '../../api/types'
import {
  buildDiabetesStatusPayload,
  buildDiabetesSymptomPayload,
  getLatestDiabetesStatus,
  getLatestSymptom,
  isStructuredDiabetesNote,
} from './diabetesModel'

function evt(id: number, event_type: string, payload: Record<string, unknown>, recorded_at: string): TimelineEvent {
  return { id, patient_id: 1, event_type, payload, source: 'real', recorded_at }
}

describe('diabetesModel', () => {
  it('getLatestDiabetesStatus returns null when never recorded', () => {
    expect(getLatestDiabetesStatus([])).toBeNull()
    expect(getLatestDiabetesStatus([evt(1, 'note', { text: 'unrelated' }, '2026-01-01T00:00:00Z')])).toBeNull()
  })

  it('getLatestDiabetesStatus returns the most recent status, not the first or array-order one', () => {
    const events = [
      evt(2, 'note', buildDiabetesStatusPayload('prediabetes'), '2026-06-01T00:00:00Z'),
      evt(1, 'note', buildDiabetesStatusPayload('not_diagnosed'), '2026-01-01T00:00:00Z'),
    ]
    const latest = getLatestDiabetesStatus(events)
    expect(latest).toEqual({ value: 'prediabetes', recordedAt: '2026-06-01T00:00:00Z' })
  })

  it('getLatestSymptom tracks each symptom independently', () => {
    const events = [
      evt(1, 'note', buildDiabetesSymptomPayload('excessive_thirst', 'yes'), '2026-01-01T00:00:00Z'),
      evt(2, 'note', buildDiabetesSymptomPayload('frequent_urination', 'no'), '2026-01-02T00:00:00Z'),
    ]
    expect(getLatestSymptom(events, 'excessive_thirst')).toEqual({ value: 'yes', recordedAt: '2026-01-01T00:00:00Z' })
    expect(getLatestSymptom(events, 'frequent_urination')).toEqual({ value: 'no', recordedAt: '2026-01-02T00:00:00Z' })
    expect(getLatestSymptom(events, 'persistent_fatigue')).toBeNull()
  })

  it('getLatestSymptom reflects an update over an earlier answer for the same symptom', () => {
    const events = [
      evt(1, 'note', buildDiabetesSymptomPayload('persistent_fatigue', 'unknown'), '2026-01-01T00:00:00Z'),
      evt(2, 'note', buildDiabetesSymptomPayload('persistent_fatigue', 'yes'), '2026-03-01T00:00:00Z'),
    ]
    expect(getLatestSymptom(events, 'persistent_fatigue')).toEqual({ value: 'yes', recordedAt: '2026-03-01T00:00:00Z' })
  })

  it('isStructuredDiabetesNote distinguishes structured diabetes notes from free-text notes', () => {
    expect(isStructuredDiabetesNote(evt(1, 'note', buildDiabetesStatusPayload('diagnosed'), '2026-01-01T00:00:00Z'))).toBe(true)
    expect(isStructuredDiabetesNote(evt(2, 'note', buildDiabetesSymptomPayload('excessive_thirst', 'no'), '2026-01-01T00:00:00Z'))).toBe(true)
    expect(isStructuredDiabetesNote(evt(3, 'note', { text: 'Patient reports mild dizziness' }, '2026-01-01T00:00:00Z'))).toBe(false)
    expect(isStructuredDiabetesNote(evt(4, 'lab_result', { test_name: 'HbA1c', value: 6.1 }, '2026-01-01T00:00:00Z'))).toBe(false)
  })
})
