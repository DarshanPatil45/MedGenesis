import { Cpu, Database, Layers, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { Health } from '../../api/types'
import { Skeleton } from '../../design-system'

/**
 * Live service readout from GET /api/health. Every value is the string
 * the backend reports — the database target, the loaded screening model
 * version, the RAG backend, the LLM path actually in use, and the active
 * policy version. Nothing here is inferred or prettified into a claim the
 * API did not make.
 */
const ROWS: { key: keyof Health; label: string; icon: typeof Cpu }[] = [
  { key: 'database', label: 'Store', icon: Database },
  { key: 'screening_model', label: 'Model', icon: Cpu },
  { key: 'rag_backend', label: 'Retrieval', icon: Layers },
  { key: 'llm', label: 'Language', icon: Sparkles },
  { key: 'policy_version', label: 'Policy', icon: ShieldCheck },
]

export function SystemStrip({ className = '' }: { className?: string }) {
  const [health, setHealth] = useState<Health | null | 'loading'>('loading')

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
  }, [])

  if (health === 'loading') {
    return (
      <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-border bg-border sm:grid-cols-5 ${className}`}>
        {ROWS.map((r) => (
          <div key={r.key} className="bg-white p-3.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-4 w-full" />
          </div>
        ))}
      </div>
    )
  }

  if (health === null) {
    return (
      <div className={`rounded-[14px] border border-rose/30 bg-rose/5 px-4 py-3 text-xs text-ink-2 ${className}`}>
        Service status unavailable — the API did not respond to the health check.
      </div>
    )
  }

  return (
    <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-border bg-border sm:grid-cols-5 ${className}`}>
      {ROWS.map(({ key, label, icon: Icon }) => (
        <div key={key} className="min-w-0 bg-white p-3.5">
          <span className="flex items-center gap-1.5 text-[0.6rem] font-bold tracking-[0.14em] text-ink-3 uppercase">
            <Icon size={11} className="text-teal" />
            {label}
          </span>
          <p className="mt-1.5 truncate font-mono text-[0.72rem] text-ink" title={String(health[key])}>
            {key === 'policy_version' ? `v${health[key]}` : String(health[key])}
          </p>
        </div>
      ))}
    </div>
  )
}
