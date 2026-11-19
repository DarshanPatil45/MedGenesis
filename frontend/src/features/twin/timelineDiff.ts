import type { TimelineEvent } from '../../api/types'
import { FIELD_LABEL, formatFieldValue } from '../intake/intakeSchema'
import { LAB_UNIT } from './clinicalModel'
import {
  DIABETES_STATUS_LABEL,
  DIABETES_SYMPTOMS,
  YES_NO_UNKNOWN_LABEL,
  isDiabetesStatusEvent,
  isDiabetesSymptomEvent,
  type DiabetesStatusValue,
  type YesNoUnknown,
} from './diabetesModel'

const SYMPTOM_LABEL: Record<string, string> = Object.fromEntries(DIABETES_SYMPTOMS.map((s) => [s.key, s.label]))

/**
 * Turns the raw event log into the readable "Sep 09 · Weight updated ·
 * 82.4 kg → 81.7 kg" entries the Digital Twin's Longitudinal Timeline
 * shows. Every `from`/`to` here is a value that was actually recorded in
 * some real event — this only ever looks BACKWARD through the real log to
 * find what a field's prior value was; it never computes or guesses one.
 */

export interface TimelineChange {
  label: string
  from: string | null
  to: string
}

export interface TimelineEntry {
  id: number
  recordedAt: string
  eventType: string
  /** One line summarizing what kind of event this was, for event types
      that aren't a field-level change (screening ran, care plan
      generated, etc). */
  summary?: string
  changes: TimelineChange[]
}

const SIMPLE_SUMMARY: Record<string, (e: TimelineEvent) => string> = {
  screening: (e) => `Screening run · ${e.payload.risk_tier ?? 'result'} tier`,
  care_plan: () => 'Care plan generated',
  chat: () => 'Assistant conversation',
  note: (e) => `Note: ${String(e.payload.text ?? '').slice(0, 80)}`,
}

function formatLabValue(value: unknown, unit: unknown): string {
  const v = typeof value === 'number' ? value : Number(value)
  return `${Number.isFinite(v) ? v : String(value)}${unit ? ` ${unit}` : ''}`
}

/**
 * Builds the timeline in one forward pass over the chronologically-sorted
 * event log, tracking the last-seen value per (event_type, key) so each
 * new value's "from" is the real prior recording, not a lookahead or a
 * guess. `events` does not need to be pre-sorted — this sorts internally.
 */
export function buildTimelineEntries(events: TimelineEvent[]): TimelineEntry[] {
  const sorted = [...events].sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())
  const lastLabValue = new Map<string, unknown>()
  const lastMeasurementValue = new Map<string, unknown>()
  const lastRunSignal = new Map<string, string>()
  const lastDiabetesValue = new Map<string, string>()
  const entries: TimelineEntry[] = []

  for (const e of sorted) {
    const changes: TimelineChange[] = []
    let skipSummary = false

    if (isDiabetesStatusEvent(e) || isDiabetesSymptomEvent(e)) {
      // Same no-op-collapsing rule as everything else: re-recording an
      // unchanged status/symptom answer carries no new information.
      skipSummary = true
      const trackKey = isDiabetesStatusEvent(e) ? 'diabetes_status' : `diabetes_symptom:${e.payload.symptom}`
      const label = isDiabetesStatusEvent(e)
        ? 'Diabetes status'
        : (SYMPTOM_LABEL[String(e.payload.symptom)] ?? String(e.payload.symptom))
      const rawValue = String(e.payload.value)
      const to = isDiabetesStatusEvent(e)
        ? (DIABETES_STATUS_LABEL[rawValue as DiabetesStatusValue] ?? rawValue)
        : (YES_NO_UNKNOWN_LABEL[rawValue as YesNoUnknown] ?? rawValue)
      const prior = lastDiabetesValue.has(trackKey) ? lastDiabetesValue.get(trackKey) : undefined
      lastDiabetesValue.set(trackKey, to)
      if (prior === to) continue
      changes.push({ label, from: prior ?? null, to })
    } else if (e.event_type === 'lab_result') {
      const testName = String(e.payload.test_name ?? '')
      const value = e.payload.value
      const unit = e.payload.unit ?? LAB_UNIT[testName]
      const prior = lastLabValue.has(testName) ? lastLabValue.get(testName) : null
      changes.push({
        label: testName,
        from: prior === null ? null : formatLabValue(prior, unit),
        to: formatLabValue(value, unit),
      })
      lastLabValue.set(testName, value)
    } else if (e.event_type === 'measurement' || e.event_type === 'lifestyle_log') {
      for (const [key, value] of Object.entries(e.payload)) {
        const prior = lastMeasurementValue.has(key) ? lastMeasurementValue.get(key) : undefined
        const from = prior === undefined ? null : formatFieldValue(key, prior)
        const to = formatFieldValue(key, value)
        lastMeasurementValue.set(key, value)
        // The seeded demo history (and any full-snapshot writer) resends
        // every key on every event, not just what actually changed — a
        // real edit already sends only the delta (IntakeWizard's edit
        // mode diffs against current_state before submitting), but this
        // log has to stay correct for BOTH writing styles. Skipping a
        // no-op is what keeps "Weight updated" meaning "the value
        // changed", not "this key was merely present in the payload".
        if (from === to) continue
        changes.push({ label: FIELD_LABEL[key] ?? key.replace(/_/g, ' '), from, to })
      }
      if (changes.length === 0) continue // nothing actually changed in this event — no entry at all
    } else if (e.event_type === 'medication_change') {
      const name = String(e.payload.medication_name ?? 'medication')
      const action = String(e.payload.action ?? 'changed')
      const dose = e.payload.dose ? ` · ${e.payload.dose}` : ''
      changes.push({ label: `${name} ${action}${dose}`, from: null, to: '' })
    } else if (e.event_type === 'screening' || e.event_type === 'care_plan') {
      // Re-running screening or care-plan generation with an unchanged
      // outcome carries no new information — the same collapsing rule as
      // a no-op measurement. Only a genuine change in outcome (or the
      // very first run) earns an entry, so repeatedly re-running from the
      // Assessment/Care Plan pages doesn't wall-paper the timeline with
      // identical "Moderate tier" lines.
      const tier = e.payload.risk_tier != null ? String(e.payload.risk_tier) : null
      const status = e.payload.status != null ? String(e.payload.status) : null
      const signal = tier ?? status ?? ''
      const prior = lastRunSignal.has(e.event_type) ? lastRunSignal.get(e.event_type) : undefined
      lastRunSignal.set(e.event_type, signal)
      if (prior === signal) continue
      if (tier !== null && prior !== undefined && prior !== '') {
        changes.push({ label: 'Risk tier', from: prior, to: tier })
      }
      // First-ever run, or a transition to/from "unable to score" — no
      // clean before/after tier to show, so the summary line alone
      // (e.g. "Screening run · Moderate tier") carries the information.
    }

    entries.push({
      id: e.id,
      recordedAt: e.recorded_at,
      eventType: e.event_type,
      summary: skipSummary ? undefined : SIMPLE_SUMMARY[e.event_type]?.(e),
      changes,
    })
  }

  return entries.reverse() // newest first, for display
}
