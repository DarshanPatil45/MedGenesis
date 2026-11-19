import { AlertTriangle, RotateCw } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { cn } from '../cn'
import { Button } from './Button'

type IconComponent = ComponentType<{ size?: number; className?: string }>

/* ── Loading: skeletons that match the final layout, never a spinner ── */

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn('skeleton', className)} style={style} aria-hidden="true" />
}

/** Skeleton shaped like a stage header (eyebrow, title, subtitle, chips). */
export function StageHeaderSkeleton() {
  return (
    <div className="mb-10" role="status" aria-label="Loading">
      <Skeleton className="h-5 w-40 rounded-full" />
      <Skeleton className="mt-5 h-12 w-80 max-w-full" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <div className="mt-6 flex gap-3">
        <Skeleton className="h-14 w-28" />
        <Skeleton className="h-14 w-28" />
        <Skeleton className="h-14 w-28" />
      </div>
    </div>
  )
}

/** Skeleton shaped like a data table. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="data-surface overflow-hidden rounded-[14px]" role="status" aria-label="Loading">
      <div className="flex gap-4 border-b border-border-strong px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-border-strong/50 px-4 py-3 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('data-surface flex items-end gap-2 rounded-[14px] p-5', className)} role="status" aria-label="Loading">
      {[45, 70, 35, 85, 55, 65, 40].map((h, i) => (
        <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
      ))}
    </div>
  )
}

/* ── Empty: illustrated + reason + suggested action ── */

export function EmptyState({
  icon: Icon,
  title,
  reason,
  action,
  className,
}: {
  icon?: IconComponent
  title: string
  reason?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[14px] border border-dashed border-border-strong px-6 py-12 text-center',
        className,
      )}
    >
      {/* Shell-layer ambient treatment — empty states are allowed drama. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,rgb(21 183 158 / 0.08),transparent_70%)]"
      />
      <div className="relative">
        {Icon && (
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border-strong bg-subtle text-teal">
            <Icon size={20} />
          </span>
        )}
        <p className="text-base font-semibold text-ink">{title}</p>
        {reason && <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">{reason}</p>}
        {action && <div className="mt-6 flex justify-center">{action}</div>}
      </div>
    </div>
  )
}

/* ── Error: inline, non-blocking, with retry ── */

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: string | null
  onRetry?: () => void
  className?: string
}) {
  if (!error) return null
  return (
    <div
      role="alert"
      className={cn(
        'mb-5 flex flex-wrap items-start gap-3 rounded-[14px] border border-rose/40 bg-rose/10 px-4 py-3',
        className,
      )}
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-sm leading-relaxed text-ink">{error}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <RotateCw size={13} /> Retry
        </Button>
      )}
    </div>
  )
}
