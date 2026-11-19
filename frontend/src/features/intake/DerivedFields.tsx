import { Calculator } from 'lucide-react'
import { ChipButton } from '../../design-system'
import {
  deriveBmi,
  deriveHvyAlcohol,
  derivePhysActivity,
  deriveServingsFlag,
  deriveSmokerFromStatus,
  type SmokingStatus,
} from '../twin/clinicalModel'

/**
 * Richer inputs that derive one of the 21 trained features live, rather
 * than asking for the coarse value directly. Each one still ends by
 * calling the SAME `FormState` setter the plain toggle would have used
 * (`onBmi`, `onYesNo`) — buildMeasurements/buildPayload never change,
 * only how the value they read gets decided. See
 * features/twin/clinicalModel.ts for the exact formula/threshold behind
 * each derivation and why some BRFSS features (diagnosis history) are
 * deliberately NOT offered a derived alternative here.
 */

const input =
  'w-full rounded-[10px] border border-border-strong bg-surface px-3 py-2 text-sm text-ink focus-visible:border-teal focus-visible:outline-none'

export function HeightWeightBmiField({
  heightCm,
  weightKg,
  bmi,
  onHeightChange,
  onWeightChange,
  onBmiChange,
}: {
  heightCm: string
  weightKg: string
  bmi: string
  onHeightChange: (v: string) => void
  onWeightChange: (v: string) => void
  onBmiChange: (v: string) => void
}) {
  const derived = deriveBmi(Number(heightCm), Number(weightKg))
  const usingDerived = heightCm.trim() !== '' && weightKg.trim() !== '' && derived !== null

  return (
    <div className="rounded-[10px] border border-border-strong bg-subtle p-3.5">
      <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
        <Calculator size={12} /> Calculate from height & weight (optional)
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-ink-3">
          Height (cm)
          <input
            type="number"
            min={1}
            step="any"
            className={`mt-1 ${input}`}
            value={heightCm}
            onChange={(e) => {
              onHeightChange(e.target.value)
              const d = deriveBmi(Number(e.target.value), Number(weightKg))
              if (d !== null) onBmiChange(String(d))
            }}
          />
        </label>
        <label className="block text-xs text-ink-3">
          Weight (kg)
          <input
            type="number"
            min={1}
            step="any"
            className={`mt-1 ${input}`}
            value={weightKg}
            onChange={(e) => {
              onWeightChange(e.target.value)
              const d = deriveBmi(Number(heightCm), Number(e.target.value))
              if (d !== null) onBmiChange(String(d))
            }}
          />
        </label>
      </div>
      {usingDerived ? (
        <p className="mt-2.5 text-xs text-ink-2">
          Computed BMI: <strong className="font-mono text-ink">{bmi}</strong>
        </p>
      ) : (
        <p className="mt-2.5 text-xs text-ink-3">Fill both to compute BMI automatically — or enter it directly above.</p>
      )}
    </div>
  )
}

export function ActivityFrequencyField({
  value,
  onChange,
}: {
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="rounded-[10px] border border-border-strong bg-subtle p-3.5">
      <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
        <Calculator size={12} /> Log frequency instead (optional)
      </p>
      <label className="block text-xs text-ink-3">
        Days per week with any physical activity
        <input
          type="number"
          min={0}
          max={7}
          className={`mt-1 ${input}`}
          onChange={(e) => onChange(Boolean(derivePhysActivity(Number(e.target.value))))}
          placeholder="0–7"
        />
      </label>
      <p className="mt-2.5 text-xs text-ink-3">
        Any nonzero value sets Physical activity to <strong>{value ? 'Yes' : 'No'}</strong> — BRFSS asks only whether
        there was any activity at all, not how much.
      </p>
    </div>
  )
}

export function ServingsField({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="rounded-[10px] border border-border-strong bg-subtle p-3.5">
      <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
        <Calculator size={12} /> Log servings instead (optional)
      </p>
      <label className="block text-xs text-ink-3">
        {label} servings per day
        <input
          type="number"
          min={0}
          step="any"
          className={`mt-1 ${input}`}
          onChange={(e) => onChange(Boolean(deriveServingsFlag(Number(e.target.value))))}
        />
      </label>
      <p className="mt-2.5 text-xs text-ink-3">
        1 or more per day sets this to <strong>{value ? 'Yes' : 'No'}</strong> — the exact BRFSS threshold.
      </p>
    </div>
  )
}

export function AlcoholFrequencyField({
  sex,
  value,
  onChange,
}: {
  sex: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  const scored = sex === 'female' || sex === 'male'
  return (
    <div className="rounded-[10px] border border-border-strong bg-subtle p-3.5">
      <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
        <Calculator size={12} /> Log drinks per week instead (optional)
      </p>
      <label className="block text-xs text-ink-3">
        Average drinks per week
        <input
          type="number"
          min={0}
          step="any"
          className={`mt-1 ${input}`}
          disabled={!scored}
          onChange={(e) => {
            const d = deriveHvyAlcohol(Number(e.target.value), sex)
            if (d !== null) onChange(Boolean(d))
          }}
        />
      </label>
      <p className="mt-2.5 text-xs text-ink-3">
        {scored ? (
          <>
            CDC heavy-drinking threshold ({sex === 'male' ? '>14/week' : '>7/week'}) sets Heavy alcohol consumption to{' '}
            <strong>{value ? 'Yes' : 'No'}</strong>.
          </>
        ) : (
          'Requires a recorded sex (female/male) to apply the correct threshold.'
        )}
      </p>
    </div>
  )
}

const SMOKING_OPTIONS: readonly [SmokingStatus, string][] = [
  ['never', 'Never smoked'],
  ['former', 'Former smoker'],
  ['current', 'Current smoker'],
]

export function SmokingStatusField({ onChange }: { onChange: (v: boolean) => void }) {
  return (
    <div className="rounded-[10px] border border-border-strong bg-subtle p-3.5">
      <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
        <Calculator size={12} /> Log smoking status instead (optional)
      </p>
      <div className="flex flex-wrap gap-1.5">
        {SMOKING_OPTIONS.map(([v, l]) => (
          <ChipButton key={v} tone="teal" onClick={() => onChange(Boolean(deriveSmokerFromStatus(v)))}>
            {l}
          </ChipButton>
        ))}
      </div>
      <p className="mt-2.5 text-xs text-ink-3">
        BRFSS asks "smoked ≥100 cigarettes in your life" — Never maps to No exactly; Former/Current map to Yes as a
        stated approximation, not an exact lifetime count.
      </p>
    </div>
  )
}
