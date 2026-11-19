import * as Slider from '@radix-ui/react-slider'
import { Check, Lock, ShieldAlert } from 'lucide-react'
import { Chip, ChipButton } from '../../design-system'
import type { YesNoDef, YesNoKey } from './intakeSchema'

/** Every field in the wizard reads one of these two badges — chosen once
    per section by the caller, never guessed at per-field, so the
    "Model-required baseline" vs "workspace only" claim is always accurate
    to what buildPayload() actually sends. */
export function ModelRequiredBadge() {
  return <Chip tone="teal">Model-required baseline</Chip>
}

export function WorkspaceOnlyBadge() {
  return <Chip tone="outline">Workspace label · not sent to the model</Chip>
}

export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <span className="text-sm font-medium text-ink">{children}</span>
      {hint && <span className="ml-2 text-xs text-ink-3">{hint}</span>}
    </div>
  )
}

/**
 * Segmented Yes/No control for one BRFSS binary feature. Every field this
 * wizard sends is boolean-valued once initialized (see EMPTY_FORM), so
 * there is no third "unset" state to represent — the toggle always shows
 * the value that would actually be submitted.
 */
export function YesNoField({
  def,
  value,
  onChange,
}: {
  def: YesNoDef
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{def.label}</p>
        {def.hint && <p className="mt-0.5 text-xs text-ink-3">{def.hint}</p>}
      </div>
      <div className="flex shrink-0 gap-1.5" role="radiogroup" aria-label={def.label}>
        <ChipButton selected={value} tone="teal" onClick={() => onChange(true)}>
          Yes
        </ChipButton>
        <ChipButton selected={!value} tone="neutral" onClick={() => onChange(false)}>
          No
        </ChipButton>
      </div>
    </div>
  )
}

export function YesNoGroup({
  defs,
  form,
  onChange,
}: {
  defs: readonly YesNoDef[]
  form: Record<YesNoKey, boolean>
  onChange: (key: YesNoKey, v: boolean) => void
}) {
  return (
    <div className="data-surface rounded-[14px] px-4">
      {defs.map((d) => (
        <YesNoField key={d.key} def={d} value={form[d.key]} onChange={(v) => onChange(d.key, v)} />
      ))}
    </div>
  )
}

/**
 * Compact selectable row-list for an ordinal BRFSS scale (GenHlth,
 * Education, Income). A horizontal segmented control cannot hold options
 * this long without truncating; a vertical list of full-width rows can.
 */
export function ScaleCardField({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string
  hint?: string
  options: readonly (readonly [string, string])[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <div className="data-surface overflow-hidden rounded-[14px]" role="radiogroup" aria-label={label}>
        {options.map(([v, l], i) => {
          const selected = v === value
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(v)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                i > 0 ? 'border-t border-border' : ''
              } ${selected ? 'bg-teal/8 text-ink' : 'text-ink-2 hover:bg-subtle'}`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                  selected ? 'border-teal bg-teal' : 'border-border-strong'
                }`}
              >
                {selected && <Check size={10} strokeWidth={3.5} className="text-white" />}
              </span>
              {l}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 0–30 day-count slider (MentHlth/PhysHlth). Deliberately not the shared
 * `LabeledSlider` — that component prefixes positive values with "+" for
 * delta framing (What-if Lab's weight/BMI change), which would misread an
 * absolute day count as a change from something.
 */
export function DaysField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string
  label: string
  hint?: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        <span className="font-mono text-sm font-semibold text-ink tabular-nums">
          {value} <span className="text-xs font-normal text-ink-3">of 30 days</span>
        </span>
      </div>
      <Slider.Root
        className="relative flex h-5 w-full touch-none items-center select-none"
        value={[value]}
        min={0}
        max={30}
        step={1}
        onValueChange={([v]) => onChange(v)}
      >
        <Slider.Track className="relative h-1.5 w-full grow rounded-full bg-border-strong">
          <Slider.Range className="absolute h-full rounded-full bg-gradient-to-r from-teal to-blue" />
        </Slider.Track>
        <Slider.Thumb
          id={id}
          aria-label={label}
          className="block h-4 w-4 rounded-full border-2 border-white bg-teal shadow-md transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
        />
      </Slider.Root>
      {hint && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

const input =
  'w-full rounded-[10px] border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus-visible:border-teal focus-visible:outline-none'

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      <input
        autoFocus={autoFocus}
        className={`mt-1.5 ${input}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {hint && <span className="mt-1.5 block text-xs font-normal text-ink-3">{hint}</span>}
    </label>
  )
}

/**
 * A field the wizard displays but cannot submit changes for — Pseudonym,
 * Age and Sex in edit mode, none of which have a backend update path
 * (`PatientCreate` only creates a row; there is no PATCH endpoint). Shown
 * read-only with an honest reason rather than silently omitted, so
 * editing never looks like data went missing.
 */
export function LockedField({ label, value, reason }: { label: string; value: string; reason: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2 rounded-[10px] border border-border-strong bg-subtle px-3 py-2.5 text-sm text-ink-2">
        <Lock size={13} className="shrink-0 text-ink-3" aria-hidden="true" />
        {value}
      </div>
      <p className="mt-1.5 text-xs text-ink-3">{reason}</p>
    </div>
  )
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step = 'any',
  unit,
  invalid,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  min?: number
  max?: number
  step?: number | 'any'
  unit?: string
  invalid?: boolean
}) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      <div className="relative mt-1.5">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          className={`${input} ${invalid ? 'border-rose/50' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
        />
        {unit && (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-3">
            {unit}
          </span>
        )}
      </div>
      {hint && <span className="mt-1.5 block text-xs font-normal text-ink-3">{hint}</span>}
    </label>
  )
}

export function SexField({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: readonly (readonly [string, string, boolean])[]
}) {
  const scored = options.find(([v]) => v === value)?.[2] ?? false
  return (
    <div>
      <FieldLabel>Sex</FieldLabel>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Sex">
        {options.map(([v, l]) => (
          <ChipButton key={v} selected={v === value} tone="teal" onClick={() => onChange(v)}>
            {l}
          </ChipButton>
        ))}
      </div>
      {!scored && (
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-amber">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" />
          The screening model has no trained encoding for this option — this profile can still be created, but
          won't produce a screening score (the same refusal path as a missing measurement).
        </p>
      )}
    </div>
  )
}
