import { CheckCircle2 } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { ComponentType, ReactNode } from 'react'
import type { EvidenceSource } from '../api/types'

export function RiskBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="badge neutral">n/a</span>
  return <span className={`badge ${tier.toLowerCase()}`}>{tier}</span>
}

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>

export function Card({
  title,
  icon: Icon,
  children,
}: {
  title?: string
  icon?: IconComponent
  children: ReactNode
}) {
  return (
    <div className="card">
      {title &&
        (Icon ? (
          <div className="section-head">
            <span className="icon-badge" aria-hidden="true">
              <Icon size={16} strokeWidth={2.2} />
            </span>
            <h2>{title}</h2>
          </div>
        ) : (
          <h2>{title}</h2>
        ))}
      {children}
    </div>
  )
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null
  return <div className="error">{error}</div>
}

export function AgentTrace({ trace }: { trace: string[] }) {
  const reduceMotion = useReducedMotion()
  if (!trace?.length) return null
  return (
    <ul className="trace">
      {trace.map((step, i) => (
        <motion.li
          key={i}
          initial={reduceMotion ? false : { opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: reduceMotion ? 0 : i * 0.05, duration: 0.25, ease: [0.2, 0, 0, 1] }}
        >
          <CheckCircle2 size={14} className="trace-check" aria-hidden="true" />
          {step}
        </motion.li>
      ))}
    </ul>
  )
}

export function Sources({ sources }: { sources: EvidenceSource[] }) {
  if (!sources?.length) return null
  return (
    <div>
      <h3>Cited sources</h3>
      {sources.map((s, i) => (
        <div key={i} style={{ marginBottom: '0.7rem', fontSize: '0.84rem' }}>
          <div>
            <strong>{s.section}</strong> — {s.publisher}
          </div>
          <div className="muted">{s.text.slice(0, 220)}…</div>
          <div className="muted">
            <a href={s.source_url} target="_blank" rel="noreferrer">
              {s.source_url}
            </a>
            {s.accessed && ` · accessed ${s.accessed}`}
          </div>
          {/* WHO material is copyrighted, so its attribution notice must ride
              along with the excerpt wherever it is displayed. */}
          {s.license?.toLowerCase().includes('copyright') && s.attribution && (
            <div className="muted" style={{ fontStyle: 'italic' }}>
              {s.attribution}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
