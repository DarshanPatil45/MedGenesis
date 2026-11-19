import type { TimelineEvent } from '../../api/types'

export interface TrendPoint {
  date: string
  value: number
}

/**
 * Extracts a chronological numeric series for one metric from the raw
 * event log — used for every Trends chart. Two sources, matching where
 * each kind of value actually lives:
 *   - `lab`: a `lab_result` event's `value`, matched by exact `test_name`
 *     (Weight, Blood Pressure (Systolic), HbA1c, ...).
 *   - `measurement`: a `measurement`/`lifestyle_log` event's payload key
 *     (bmi, phys_hlth, ment_hlth, ...) — these fold into `current_state`,
 *     but folding only keeps the LATEST value; this walks the full event
 *     history to recover every value that was ever recorded, in order.
 * Returns points only where the metric was actually recorded — never
 * interpolated, never backfilled.
 */
function extractOne(events: TimelineEvent[], source: 'lab' | 'measurement', key: string): TrendPoint[] {
  const points: TrendPoint[] = []
  for (const e of events) {
    if (source === 'lab') {
      if (e.event_type !== 'lab_result' || e.payload.test_name !== key) continue
      const v = e.payload.value
      if (typeof v === 'number') points.push({ date: e.recorded_at, value: v })
    } else {
      if (e.event_type !== 'measurement' && e.event_type !== 'lifestyle_log') continue
      if (!(key in e.payload)) continue
      const v = Number(e.payload[key])
      if (Number.isFinite(v)) points.push({ date: e.recorded_at, value: v })
    }
  }
  return points
}

export function extractSeries(
  events: TimelineEvent[],
  source: 'lab' | 'measurement',
  key: string,
  /**
   * Additional (source, key) pairs to merge in — for a metric recorded
   * under two different conventions over the patient's history (the
   * seeded demo history predates the `lab_result` "Weight"/"Height"
   * convention and instead carries `weight_kg`/`height_m` as measurement
   * keys). Both are real recorded values; merging them is what makes the
   * trend span the patient's actual full history instead of only
   * whatever was recorded after this convention existed.
   */
  fallbacks: readonly { source: 'lab' | 'measurement'; key: string }[] = [],
): TrendPoint[] {
  const points = [...extractOne(events, source, key), ...fallbacks.flatMap((f) => extractOne(events, f.source, f.key))]
  return points.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}
