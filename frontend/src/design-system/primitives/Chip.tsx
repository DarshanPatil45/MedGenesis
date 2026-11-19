import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react'
import { cn } from '../cn'

const chip = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-45',
  {
    variants: {
      tone: {
        neutral: 'border-border-strong bg-subtle text-ink-2',
        teal: 'border-teal/40 bg-teal/12 text-teal',
        blue: 'border-blue/40 bg-blue/12 text-blue',
        violet: 'border-violet/40 bg-violet/12 text-violet',
        amber: 'border-amber/40 bg-amber/12 text-amber',
        rose: 'border-rose/40 bg-rose/12 text-rose',
        outline: 'border-border-strong bg-transparent text-ink-3',
      },
      interactive: { true: 'cursor-pointer hover:border-ink-3 hover:text-ink', false: '' },
    },
    defaultVariants: { tone: 'neutral', interactive: false },
  },
)

type IconComponent = ComponentType<{ size?: number; className?: string }>

export type ChipTone = NonNullable<VariantProps<typeof chip>['tone']>

/** Static status/label chip. */
export function Chip({
  tone,
  icon: Icon,
  dot,
  children,
  className,
}: {
  tone?: ChipTone
  icon?: IconComponent
  dot?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cn(chip({ tone }), className)}>
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {Icon && <Icon size={12} className="shrink-0" />}
      {children}
    </span>
  )
}

/** Clickable filter/toggle chip. */
export function ChipButton({
  tone,
  selected,
  icon: Icon,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ChipTone
  selected?: boolean
  icon?: IconComponent
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(chip({ tone: selected ? (tone ?? 'teal') : 'neutral', interactive: true }), className)}
      {...props}
    >
      {Icon && <Icon size={12} className="shrink-0" />}
      {children}
    </button>
  )
}
