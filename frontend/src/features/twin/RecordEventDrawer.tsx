import { CalendarPlus, Check, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { TimelineEvent } from '../../api/types'
import { Button, Drawer, SAFETY_DISCLAIMER } from '../../design-system'
import {
  CARDIOMETABOLIC,
  EDUCATION_OPTIONS,
  FUNCTIONAL_YESNO,
  GEN_HLTH_OPTIONS,
  HEALTHCARE,
  INCOME_OPTIONS,
  LIFESTYLE,
  formatFieldValue,
  type YesNoDef,
} from '../intake/intakeSchema'
import { DaysField, ScaleCardField, YesNoField } from '../intake/IntakeFields'

type FieldKind = 'yesno' | 'gen_hlth' | 'days' | 'education' | 'income' | 'bmi'
interface FieldDef {
  key: string
  label: string
  kind: FieldKind
  yesNoDef?: YesNoDef
}

/** The same 19 backend-recognized measurement fields Edit Patient Baseline
    offers — a "new event" is not a smaller vocabulary, just a smaller,
    user-chosen slice of it recorded at a fresh point in time. */
const RECORDABLE_FIELDS: FieldDef[] = [
  { key: 'bmi', label: 'BMI', kind: 'bmi' },
  ...CARDIOMETABOLIC.map((d) => ({ key: d.key, label: d.label, kind: 'yesno' as const, yesNoDef: d })),
  ...FUNCTIONAL_YESNO.map((d) => ({ key: d.key, label: d.label, kind: 'yesno' as const, yesNoDef: d })),
  { key: 'gen_hlth', label: 'General health', kind: 'gen_hlth' },
  { key: 'phys_hlth', label: 'Poor physical-health days', kind: 'days' },
  { key: 'ment_hlth', label: 'Poor mental-health days', kind: 'days' },
  ...LIFESTYLE.map((d) => ({ key: d.key, label: d.label, kind: 'yesno' as const, yesNoDef: d })),
  ...HEALTHCARE.map((d) => ({ key: d.key, label: d.label, kind: 'yesno' as const, yesNoDef: d })),
  { key: 'education', label: 'Education', kind: 'education' },
  { key: 'income', label: 'Household income', kind: 'income' },
]

/**
 * "Record new event" — deliberately a different shape from Edit Patient
 * Baseline, not a smaller copy of it. Baseline editing walks all 21
 * features and asks "is this still accurate"; this asks "what did you
 * just observe" — pick only the field(s) relevant right now, in a single
 * lightweight panel rather than a 7-step flow.
 *
 * Traceable by construction: this writes `event_type: "lifestyle_log"`,
 * Edit Patient Baseline writes `"measurement"` — both already exist in the
 * backend's event vocabulary and both already fold into `current_state`
 * identically (twin.py STATE_EVENT_TYPES), so the two actions get a real,
 * backend-native distinction — a different lane and colour on the
 * Longitudinal Canvas (TimelineCanvas.tsx LANE_LABEL) — without adding
 * anything to the payload or touching the backend at all.
 */
export function RecordEventDrawer({
  open,
  onOpenChange,
  patientId,
  currentState,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: number
  currentState: Record<string, unknown>
  onSaved: (event: TimelineEvent) => Promise<void> | void
}) {
  const [included, setIncluded] = useState<Set<string>>(new Set())
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setIncluded(new Set())
      setValues({})
      setError(null)
    }
  }, [open])

  const toggle = (field: FieldDef) => {
    setIncluded((prev) => {
      const next = new Set(prev)
      if (next.has(field.key)) {
        next.delete(field.key)
      } else {
        next.add(field.key)
        // Seed the input from the current value so the user is adjusting
        // a known reading, not starting from a blank field. Yes/No fields
        // are stored here as the strings 'true'/'false' (not the backend's
        // 0/1), so seeding from a raw 0/1 current value has to convert —
        // `String(1)` is "1", which would never equal 'true' and would
        // silently seed every field to "No" regardless of its real value.
        setValues((v) => {
          if (v[field.key] !== undefined) return v
          const raw = currentState[field.key]
          if (raw === undefined) return v
          const seeded = field.kind === 'yesno' ? String(Boolean(Number(raw))) : String(raw)
          return { ...v, [field.key]: seeded }
        })
      }
      return next
    })
  }

  const setValue = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }))

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, number> = {}
      for (const key of included) {
        const raw = values[key]
        const field = RECORDABLE_FIELDS.find((f) => f.key === key)!
        payload[key] = field.kind === 'yesno' ? (raw === 'true' ? 1 : 0) : Number(raw)
      }
      const event = await api.appendEvent(patientId, { event_type: 'lifestyle_log', payload })
      await onSaved(event)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      width="lg"
      title="Record new event"
      description="A fresh, timestamped observation — separate from a baseline edit. Existing recorded values stay exactly where they are; only the fields you pick here get a new entry."
      footer={
        <div>
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy || included.size === 0}>
              <CalendarPlus size={14} />
              {busy ? 'Recording…' : `Record event${included.size ? ` · ${included.size}` : ''}`}
            </Button>
          </div>
          <p className="mt-2.5 text-[0.64rem] leading-relaxed text-ink-3">{SAFETY_DISCLAIMER}</p>
        </div>
      }
    >
      {error && (
        <div role="alert" className="mb-5 rounded-[10px] border border-rose/40 bg-rose/10 px-4 py-3 text-sm text-ink">
          {error}
        </div>
      )}

      <p className="mb-4 text-xs leading-relaxed text-ink-3">
        Select what you observed. Each selected field starts from its current recorded value — adjust it, or leave
        it as confirmation that it's unchanged.
      </p>

      <ul className="space-y-2">
        {RECORDABLE_FIELDS.map((field) => {
          const isIncluded = included.has(field.key)
          const currentVal = formatFieldValue(field.key, currentState[field.key])
          return (
            <li
              key={field.key}
              className={`overflow-hidden rounded-[14px] border transition-colors ${
                isIncluded ? 'border-teal/40 bg-subtle' : 'border-border-strong bg-surface'
              }`}
            >
              <button
                type="button"
                onClick={() => toggle(field)}
                aria-pressed={isIncluded}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border-2 ${
                    isIncluded ? 'border-teal bg-teal' : 'border-border-strong'
                  }`}
                >
                  {isIncluded ? (
                    <Check size={11} strokeWidth={3.5} className="text-white" />
                  ) : (
                    <Plus size={11} className="text-ink-3" />
                  )}
                </span>
                <span className="min-w-0 flex-1 text-sm font-medium text-ink">{field.label}</span>
                <span className="shrink-0 text-xs text-ink-3">Current: {currentVal}</span>
              </button>

              {isIncluded && (
                <div className="border-t border-border-strong bg-surface px-3.5 py-3.5">
                  {field.kind === 'yesno' && field.yesNoDef && (
                    <YesNoField
                      def={field.yesNoDef}
                      value={values[field.key] === 'true'}
                      onChange={(v) => setValue(field.key, String(v))}
                    />
                  )}
                  {field.kind === 'bmi' && (
                    <label className="block text-sm font-medium text-ink">
                      New BMI
                      <input
                        type="number"
                        min={1}
                        max={100}
                        step="any"
                        className="mt-1.5 w-full rounded-[10px] border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-teal focus-visible:outline-none"
                        value={values[field.key] ?? ''}
                        onChange={(e) => setValue(field.key, e.target.value)}
                      />
                    </label>
                  )}
                  {field.kind === 'gen_hlth' && (
                    <ScaleCardField
                      label="Self-rated general health"
                      options={GEN_HLTH_OPTIONS}
                      value={values[field.key] ?? ''}
                      onChange={(v) => setValue(field.key, v)}
                    />
                  )}
                  {field.kind === 'education' && (
                    <ScaleCardField
                      label="Education level"
                      options={EDUCATION_OPTIONS}
                      value={values[field.key] ?? ''}
                      onChange={(v) => setValue(field.key, v)}
                    />
                  )}
                  {field.kind === 'income' && (
                    <ScaleCardField
                      label="Household income"
                      options={INCOME_OPTIONS}
                      value={values[field.key] ?? ''}
                      onChange={(v) => setValue(field.key, v)}
                    />
                  )}
                  {field.kind === 'days' && (
                    <DaysField
                      id={`record-${field.key}`}
                      label={field.label}
                      value={Number(values[field.key] ?? 0)}
                      onChange={(v) => setValue(field.key, String(v))}
                    />
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Drawer>
  )
}
