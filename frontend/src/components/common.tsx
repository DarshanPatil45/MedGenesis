import type { ReactNode } from 'react'
import type { EvidenceSource } from '../api/types'

export function RiskBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="badge neutral">n/a</span>
  return <span className={`badge ${tier.toLowerCase()}`}>{tier}</span>
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="card">
      {title && <h2>{title}</h2>}
      {children}
    </div>
  )
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null
  return <div className="error">{error}</div>
}

export function AgentTrace({ trace }: { trace: string[] }) {
  if (!trace?.length) return null
  return (
    <ul className="trace">
      {trace.map((step, i) => (
        <li key={i}>{step}</li>
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
