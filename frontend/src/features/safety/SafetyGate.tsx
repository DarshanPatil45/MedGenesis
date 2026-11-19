import { Ban, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ComponentType } from 'react'
import type { Safety } from '../../api/types'
import { cn } from '../../design-system'

const CONFIG: Record<
  string,
  { label: string; icon: ComponentType<{ size?: number; className?: string }>; ring: string; accent: string; bar: string }
> = {
  APPROVED: { label: 'Approved', icon: ShieldCheck, ring: 'border-teal/35', accent: 'text-teal', bar: 'bg-teal' },
  FLAGGED_FOR_CLINICIAN_REVIEW: { label: 'Flagged for clinician review', icon: ShieldAlert, ring: 'border-amber/45', accent: 'text-amber', bar: 'bg-amber' },
  BLOCKED: { label: 'Blocked', icon: Ban, ring: 'border-rose/45', accent: 'text-rose', bar: 'bg-rose' },
}

/**
 * The final system gate. Every agent route terminates at the Safety
 * Agent, so this closes each result surface.
 *
 * Everything the backend returns — status, banner, every reason, the
 * disclaimer — is rendered verbatim. Nothing is truncated, softened or
 * conditionally hidden based on the verdict.
 */
export function SafetyGate({ safety, className }: { safety: Safety; className?: string }) {
  const cfg = CONFIG[safety.status] ?? CONFIG.APPROVED
  const Icon = cfg.icon

  return (
    <section
      role="status"
      aria-label="Safety gate result"
      className={cn('relative overflow-hidden rounded-[14px] border bg-surface', cfg.ring, className)}
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', cfg.bar)} />
      <div className="flex items-start gap-4 p-5 pl-6">
        <Icon size={22} className={cn('mt-0.5 shrink-0', cfg.accent)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.6rem] font-bold tracking-[0.2em] text-ink-3 uppercase">Safety gate</p>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3">
            <span className={cn('text-lg font-bold tracking-tight', cfg.accent)}>{cfg.label}</span>
            <span className="font-mono text-xs text-ink-3">{safety.status}</span>
            <span className="text-xs text-ink-3">policy v{safety.policy_version}</span>
          </p>

          {safety.banner && <p className="mt-3 text-sm font-medium text-ink">{safety.banner}</p>}

          {safety.reasons.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {safety.reasons.map((r) => (
                <li key={r} className="flex gap-2 text-sm text-ink">
                  <span aria-hidden="true" className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', cfg.bar)} />
                  {r}
                </li>
              ))}
            </ul>
          )}

          {safety.disclaimer && (
            <p className="mt-3 border-t border-border-strong pt-3 text-xs leading-relaxed text-ink-2">
              {safety.disclaimer}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
