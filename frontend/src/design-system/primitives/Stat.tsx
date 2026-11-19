import type { ComponentType, ReactNode } from 'react'
import { cn } from '../cn'

type IconComponent = ComponentType<{ size?: number; className?: string }>

/**
 * A single readout. `emphasis="key"` applies the one gradient treatment
 * reserved for a stage's headline metric — use at most one per view.
 */
export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  emphasis = 'normal',
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: IconComponent
  emphasis?: 'normal' | 'key' | 'large'
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <span className="flex items-center gap-1.5 text-[0.62rem] font-bold tracking-[0.14em] text-ink-2 uppercase">
        {Icon && <Icon size={11} />}
        {label}
      </span>
      <span
        className={cn(
          'mt-1 block font-mono tabular-nums',
          emphasis === 'key' && 'text-gradient font-sans text-3xl font-bold tracking-tight',
          emphasis === 'large' && 'text-2xl font-semibold text-ink',
          emphasis === 'normal' && 'text-base font-medium text-ink',
        )}
      >
        {value}
      </span>
      {hint && <span className="mt-0.5 block text-[0.68rem] text-ink-3">{hint}</span>}
    </div>
  )
}

/** Horizontal strip of stats divided by hairlines — not a card grid. */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap divide-x divide-border-strong', className)}>{children}</div>
  )
}

export function StatRowItem({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex-1 basis-32 px-4 py-3 first:pl-0', className)}>{children}</div>
}
