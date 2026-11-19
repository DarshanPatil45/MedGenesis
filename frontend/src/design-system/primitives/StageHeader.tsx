import { motion, useReducedMotion } from 'motion/react'
import type { ComponentType, ReactNode } from 'react'
import { cn } from '../cn'
import { heroTransition, stageReveal } from '../motion'

type IconComponent = ComponentType<{ size?: number; className?: string }>

/**
 * The stage header every page opens with: oversized display title, a
 * one-line subtitle, an ambient visual, and 2–4 key metric readings.
 *
 * Shell layer. On a light ground the "cinematic" treatment is a layered
 * blueprint substrate — faint engineering grid, soft colour wash, precise
 * hairlines — rather than glow.
 */
export function StageHeader({
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  title,
  subtitle,
  metrics,
  aside,
  actions,
  className,
}: {
  eyebrow: string
  eyebrowIcon?: IconComponent
  title: ReactNode
  subtitle?: ReactNode
  /** 2–4 key readings, every value from a real API response. */
  metrics?: ReactNode
  /** Ambient visual element (right side on wide screens). */
  aside?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  const reduced = useReducedMotion()

  return (
    // A <div>, not <header>: only the app command bar should expose the
    // `banner` landmark. The <h1> below carries the page structure.
    <div className={cn('relative overflow-hidden', className)}>
      {/* Layered substrate — grid fades out downward so it never competes
          with the data sections that follow. */}
      <div aria-hidden="true" className="pointer-events-none absolute -inset-x-8 -top-14 bottom-0 overflow-hidden">
        <div
          className="shell-grid absolute inset-0"
          style={{
            maskImage: 'radial-gradient(70% 80% at 20% 0%, black, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(70% 80% at 20% 0%, black, transparent 75%)',
          }}
        />
        <div className="shell-wash absolute inset-0" />
      </div>

      <motion.div
        className="relative"
        variants={stageReveal}
        initial={reduced ? false : 'hidden'}
        animate="visible"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-8">
          <div className="min-w-0 max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-teal/25 bg-white px-3 py-1 text-[0.64rem] font-bold tracking-[0.18em] text-teal uppercase shadow-[var(--shadow-xs)]">
              {EyebrowIcon ? (
                <EyebrowIcon size={12} />
              ) : (
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-teal" />
              )}
              {eyebrow}
            </span>

            <h1 className="font-display mt-5 text-[2.5rem] leading-[1.04] tracking-[-0.015em] text-ink sm:text-5xl lg:text-[3.4rem]">
              {title}
            </h1>

            {subtitle && (
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-2 sm:text-[0.95rem]">{subtitle}</p>
            )}

            {actions && <div className="mt-7 flex flex-wrap items-center gap-3">{actions}</div>}
          </div>

          {aside && (
            <motion.div
              className="relative w-full max-w-sm shrink-0 lg:w-auto"
              initial={reduced ? false : { opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ ...heroTransition, delay: reduced ? 0 : 0.1 }}
            >
              {aside}
            </motion.div>
          )}
        </div>

        {/*
          Hairline rules between readings, not gaps alone — it is the
          difference between four floating labels and an instrument panel.
          Applied via child selectors because `metrics` arrives as a fragment
          of Stats, and `divide-x` breaks across flex-wrap rows.
        */}
        {metrics && (
          <div className="mt-9 flex flex-wrap items-stretch gap-y-4 rounded-[14px] border border-border bg-white/70 px-5 py-4 shadow-[var(--shadow-xs)] backdrop-blur-sm [&>*]:border-l [&>*]:border-border [&>*]:pl-6 [&>*]:pr-6 [&>*:first-child]:border-l-0 [&>*:first-child]:pl-0">
            {metrics}
          </div>
        )}
      </motion.div>
    </div>
  )
}
