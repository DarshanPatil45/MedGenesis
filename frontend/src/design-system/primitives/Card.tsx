import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../cn'

const card = cva('rounded-[14px]', {
  variants: {
    /**
     * `data` = calm data layer (tables, charts, forms) — flat, no glow.
     * `shell` = cinematic layer (stage panels, empty states) — allowed
     * ambient treatment. Keep glow out of data zones.
     */
    layer: {
      data: 'data-surface',
      raised: 'data-surface-raised',
      shell: 'border border-border-strong bg-surface/60 backdrop-blur-sm',
      bare: 'border border-dashed border-border-strong',
    },
    pad: { none: 'p-0', sm: 'p-4', md: 'p-5', lg: 'p-6 sm:p-7' },
  },
  defaultVariants: { layer: 'data', pad: 'md' },
})

export type CardProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof card>

export function Card({ className, layer, pad, ...props }: CardProps) {
  return <div className={cn(card({ layer, pad }), className)} {...props} />
}

/** Small uppercase section label used inside cards and stage sections. */
/**
 * Section label. The leading accent bar anchors what would otherwise be
 * small grey caps floating in whitespace, and gives every section across
 * the app the same left edge to align to.
 */
export function CardLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'mb-3 flex items-center gap-2 text-[0.66rem] font-bold tracking-[0.16em] text-ink-2 uppercase',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="h-3 w-[3px] shrink-0 rounded-full bg-gradient-to-b from-teal to-blue"
      />
      {children}
    </span>
  )
}
