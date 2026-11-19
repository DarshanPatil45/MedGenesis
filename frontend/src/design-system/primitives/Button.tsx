import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../cn'

const button = cva(
  'inline-flex items-center justify-center gap-2 font-semibold transition-[background,border-color,color,transform,box-shadow] duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-45 active:translate-y-px whitespace-nowrap',
  {
    variants: {
      variant: {
        /** The one gradient CTA. Reserved for the primary action per view. */
        primary:
          'border border-transparent bg-gradient-to-br from-teal to-blue text-white hover:brightness-110 disabled:brightness-75',
        secondary:
          'border border-border-strong bg-subtle text-ink hover:border-ink-3 hover:bg-border-strong',
        ghost: 'border border-transparent bg-transparent text-ink-2 hover:bg-subtle hover:text-ink',
        danger: 'border border-rose/40 bg-rose/12 text-rose hover:bg-rose/20',
      },
      size: {
        sm: 'rounded-[10px] px-3 py-1.5 text-xs',
        md: 'rounded-[10px] px-4 py-2.5 text-sm',
        lg: 'rounded-[12px] px-5 py-3 text-sm',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size }), className)} {...props} />
}
