import { motion, useReducedMotion } from 'motion/react'

// The backend renders SHAP contributions into prose using an exact,
// deterministic template — `f"{name} ({value:+.3f})"` joined by ", "
// (app/agents/clinical_agent.py::_xgboost_model_claims). This extracts
// those already-computed (name, value) pairs purely for visual
// presentation — it computes nothing new. If the text ever doesn't match
// (e.g. a future backend change), it simply yields no matches and the
// caller falls back to the plain claim text, never inventing a value.
export function parseSignedFeatures(text: string): { name: string; value: number }[] {
  return [...text.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*\(([+-]\d+\.\d+)\)/g)].map((m) => ({
    name: m[1],
    value: Number(m[2]),
  }))
}

// RandomForest's aggregate contribution claim lists feature names only, no
// magnitudes (the backend never computes per-patient importance for the
// production model) — extract just the ranked names after the final colon.
export function parseNamedList(text: string): string[] {
  const afterColon = text.split(':').pop() ?? ''
  return afterColon
    .replace(/\.$/, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function RankedFeatureList({ text }: { text: string }) {
  const names = parseNamedList(text)
  if (names.length === 0) return <p style={{ fontSize: '0.86rem' }}>{text}</p>
  return (
    <ol className="ranked-list">
      {names.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ol>
  )
}

export function ShapBars({ text }: { text: string }) {
  const reduceMotion = useReducedMotion()
  const features = parseSignedFeatures(text)
  if (features.length === 0) return <p style={{ fontSize: '0.86rem' }}>{text}</p>
  const maxAbs = Math.max(...features.map((f) => Math.abs(f.value)), 0.001)
  return (
    <div className="shap-bars">
      {features.map((f, i) => (
        <div key={f.name} className="shap-row">
          <span className="shap-label">{f.name}</span>
          <span className="shap-track">
            <motion.span
              className={`shap-fill ${f.value >= 0 ? 'pos' : 'neg'}`}
              initial={reduceMotion ? false : { width: 0 }}
              animate={{ width: `${(Math.abs(f.value) / maxAbs) * 100}%` }}
              transition={{ duration: 0.5, delay: reduceMotion ? 0 : i * 0.06, ease: [0.2, 0, 0, 1] }}
            />
          </span>
          <span className="shap-value muted">
            {f.value > 0 ? '+' : ''}
            {f.value.toFixed(3)}
          </span>
        </div>
      ))}
      <p className="muted" style={{ fontSize: '0.76rem', marginTop: '0.5rem', marginBottom: 0 }}>
        Red pushed the score higher; green pushed it lower. Bar length reflects the size of that
        effect, not clinical severity.
      </p>
    </div>
  )
}
