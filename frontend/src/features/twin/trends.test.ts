import { describe, expect, it } from 'vitest'
import type { TimelineEvent } from '../../api/types'
import { extractSeries } from './trends'

function evt(event_type: string, payload: Record<string, unknown>, recorded_at: string): TimelineEvent {
  return { id: Math.random(), patient_id: 1, event_type, payload, source: 'real', recorded_at }
}

describe('extractSeries', () => {
  it('extracts a lab series matched by exact test_name, in chronological order regardless of input order', () => {
    const events = [
      evt('lab_result', { test_name: 'Weight', value: 81.7 }, '2026-09-09T00:00:00Z'),
      evt('lab_result', { test_name: 'Weight', value: 82.4 }, '2026-03-10T00:00:00Z'),
    ]
    expect(extractSeries(events, 'lab', 'Weight')).toEqual([
      { date: '2026-03-10T00:00:00Z', value: 82.4 },
      { date: '2026-09-09T00:00:00Z', value: 81.7 },
    ])
  })

  it('never mixes two different lab tests into one series', () => {
    const events = [
      evt('lab_result', { test_name: 'Weight', value: 80 }, '2026-01-01T00:00:00Z'),
      evt('lab_result', { test_name: 'HbA1c', value: 6.8 }, '2026-01-02T00:00:00Z'),
    ]
    expect(extractSeries(events, 'lab', 'Weight')).toHaveLength(1)
  })

  it('extracts a measurement-key series across the full event history, not just the latest', () => {
    const events = [
      evt('measurement', { bmi: 28.4 }, '2026-03-01T00:00:00Z'),
      evt('measurement', { bmi: 29.0 }, '2026-06-01T00:00:00Z'),
      evt('measurement', { bmi: 30.1 }, '2026-09-01T00:00:00Z'),
    ]
    expect(extractSeries(events, 'measurement', 'bmi').map((p) => p.value)).toEqual([28.4, 29.0, 30.1])
  })

  it('reads from lifestyle_log events too, not only measurement', () => {
    const events = [evt('lifestyle_log', { hvy_alcohol_consump: 1 }, '2026-01-01T00:00:00Z')]
    expect(extractSeries(events, 'measurement', 'hvy_alcohol_consump')).toEqual([{ date: '2026-01-01T00:00:00Z', value: 1 }])
  })

  it('skips a measurement event that never mentions the requested key', () => {
    const events = [evt('measurement', { high_bp: 1 }, '2026-01-01T00:00:00Z')]
    expect(extractSeries(events, 'measurement', 'bmi')).toEqual([])
  })

  it('returns an empty series rather than inventing points when nothing was recorded', () => {
    expect(extractSeries([], 'lab', 'Weight')).toEqual([])
  })
})
