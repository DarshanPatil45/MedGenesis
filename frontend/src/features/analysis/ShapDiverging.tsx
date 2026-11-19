import { motion, useReducedMotion } from 'motion/react'
import { color } from '../../design-system'

/**
 * The backend renders per-patient SHAP contributions into prose with an
 * exact deterministic template — `f"{name} ({value:+.3f})"` joined by ", "
 * (app/agents/clinical_agent.py::_xgboost_model_claims), top-5 features.
 * There is no structured SHAP endpoint, so these already-computed pairs
 * are extracted for presentation only; nothing is calculated here.
 *
 * If the template ever changes, this yields no matches and the caller
 * falls back to the plain claim text rather than inventing a value.
 */
export function parseSignedFeatures(text: string): { name: string; value: number }[] {
  return [...text.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*\(([+-]\d+\.\d+)\)/g)].map((m) => ({
    name: m[1],
    value: Number(m[2]),
  }))
}

/**
 * The production RandomForest claim lists feature names only — the
 * backend never computes per-patient importance for it — so only the
 * ranked names after the final colon are extracted.
 */
export function parseNamedList(text: string): string[] {
  return (text.split(':').pop() ?? '')
    .replace(/\.$/, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function RankedFeatureList({ text }: { text: string }) {
  const names = parseNamedList(text)
  if (names.length === 0) return <p className="text-sm text-ink-2">{text}</p>
  return (
    <ol className="flex flex-col gap-2">
      {names.map((n, i) => (
        <li key={n} className="flex items-center gap-3 text-sm">
          <span className="w-4 shrink-0 font-mono text-xs text-ink-3 tabular-nums">{i + 1}</span>
          <span className="font-medium text-ink">{n}</span>
        </li>
      ))}
    </ol>
  )
}

/** Horizontal diverging chart of real signed per-patient SHAP values. */
export function ShapDiverging({ text }: { text: string }) {
  const reduced = useReducedMotion()
  const features = parseSignedFeatures(text)
  if (features.length === 0) return <p className="text-sm text-ink-2">{text}</p>
  const maxAbs = Math.max(...features.map((f) => Math.abs(f.value)), 0.001)

  return (
    <div>
      <div className="mb-3 flex justify-between text-[0.6rem] font-bold tracking-[0.12em] uppercase">
        <span style={{ color: color.tealBright }}>← lowers score</span>
        <span style={{ color: color.rose }}>raises score →</span>
      </div>

      <div className="flex flex-col gap-2.5">
        {features.map((f, i) => {
          const positive = f.value >= 0
          return (
            <div key={f.name} className="grid grid-cols-[minmax(0,88px)_1fr_58px] items-center gap-3 text-sm">
              <span className="truncate font-medium text-ink" title={f.name}>
                {f.name}
              </span>
              <span className="relative h-2.5 rounded-full bg-border-strong">
                <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-ink-3/40" />
                <motion.span
                  className="absolute top-0 h-full rounded-full"
                  style={{
                    background: positive ? color.rose : color.tealBright,
                    ...(positive ? { left: '50%' } : { right: '50%' }),
                  }}
                  initial={reduced ? false : { width: 0 }}
                  animate={{ width: `${(Math.abs(f.value) / maxAbs) * 50}%` }}
                  transition={{ duration: 0.5, delay: reduced ? 0 : i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                />
              </span>
              <span
                className="text-right font-mono text-xs tabular-nums"
                style={{ color: positive ? color.rose : color.tealBright }}
              >
                {positive ? '+' : ''}
                {f.value.toFixed(3)}
              </span>
            </div>
          )
        })}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-3">
        Bar direction shows whether a feature pushed this patient's predicted score up or down; length shows the size
        of that effect, not clinical severity. Contributions describe model input influence — they do not establish
        causality.
      </p>
    </div>
  )
}
