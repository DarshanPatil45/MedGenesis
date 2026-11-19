import type { ReactNode } from 'react'
import { cn } from '../cn'
import { color } from '../tokens'

/**
 * Proportion bar for a real count-of-total. `value` and `total` must both
 * come from actual data — this never renders a decorative fill.
 */
export function RatioBar({
  value,
  total,
  label,
  tone = color.teal,
  className,
}: {
  value: number
  total: number
  label?: ReactNode
  tone?: string
  className?: string
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[0.68rem]">
          <span className="text-ink-3">{label}</span>
          <span className="font-mono font-semibold text-ink tabular-nums">
            {value}
            <span className="text-ink-3">/{total}</span>
          </span>
        </div>
      )}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[#eef2f7]"
        role="img"
        aria-label={`${value} of ${total} (${pct}%)`}
      >
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: tone }} />
      </div>
    </div>
  )
}

/**
 * Compact sparkline over a real numeric series. Renders nothing for
 * fewer than two points rather than drawing a flat placeholder line.
 */
export function Sparkline({
  values,
  tone = color.teal,
  className,
  width = 96,
  height = 26,
}: {
  values: number[]
  tone?: string
  className?: string
  width?: number
  height?: number
}) {
  if (!values || values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = width / (values.length - 1)
  const pts = values.map((v, i) => [i * step, height - ((v - min) / span) * (height - 4) - 2] as const)
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${d} L${width},${height} L0,${height} Z`
  const last = pts[pts.length - 1]

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <path d={area} fill={tone} opacity="0.10" />
      <path d={d} fill="none" stroke={tone} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill={tone} />
    </svg>
  )
}

/** Numbered section marker — editorial precision for page sections. */
export function SectionIndex({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <span className="font-mono text-[0.7rem] font-semibold text-teal tabular-nums">
        {String(n).padStart(2, '0')}
      </span>
      <span className="text-[0.66rem] font-bold tracking-[0.16em] text-ink-2 uppercase">{children}</span>
      <span className="rule-fade ml-1 hidden flex-1 sm:block" aria-hidden="true" />
    </div>
  )
}
