import { CircleAlert, CircleCheck } from 'lucide-react'
import { Card, CardLabel, color } from '../../design-system'
import { type FeatureMapping } from './clinicalModel'

/**
 * The explicit mapping layer, made visible: every one of the 21 trained
 * features, whether it's currently on file, and — for a missing one —
 * exactly what richer data would establish it. This is the honest
 * alternative to silently guessing: a missing feature stays missing, and
 * the existing eligibility/safety behaviour applies exactly as before
 * (this panel changes nothing about what the backend will or won't score
 * — it only explains what's already true).
 */
export function ModelFeatureMappingPanel({ rows }: { rows: FeatureMapping[] }) {
  const missing = rows.filter((r) => !r.present)

  return (
    <div className="mb-10">
      <CardLabel>Model feature mapping</CardLabel>
      <p className="mb-4 max-w-2xl text-sm leading-relaxed text-ink-2">
        The screening model needs all 21 of these to produce a score. Each row shows whether it's currently on
        file — never a guess.
      </p>
      <Card layer="data" pad="none" className="overflow-hidden">
        <ul className="divide-y divide-border-strong">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
              <span className="flex min-w-0 items-center gap-2.5">
                {row.present ? (
                  <CircleCheck size={14} className="shrink-0" style={{ color: color.teal }} />
                ) : (
                  <CircleAlert size={14} className="shrink-0" style={{ color: color.amber }} />
                )}
                <span className="truncate text-ink-2">{row.label}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className={row.present ? 'font-medium text-ink' : 'font-medium text-amber'}>{row.value}</span>
                {row.derivableFrom && (
                  <span className="ml-2 text-xs text-ink-3">via {row.derivableFrom}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {missing.length === 0 && (
        <p className="mt-3 text-xs text-ink-3">All 21 features are on file — this patient is screening-ready.</p>
      )}
    </div>
  )
}
