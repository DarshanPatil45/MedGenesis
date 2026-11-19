import { ChevronRight, Menu, ShieldAlert, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  AnatomicalBackdrop,
  InfoTooltip,
  SAFETY_DISCLAIMER,
  TooltipProvider,
  useMediaQuery,
} from '../design-system'
import { CommandPalette } from './CommandPalette'
import { BRAND_ICON, JOURNEY, ROUTES, stageIndexFor } from './journey'
import { PatientChip } from './PatientChip'

/** Persistent educational-use disclaimer. Required on every route. */
function SafetyPill() {
  /*
   * The tooltip only earns its place where the label is truncated. At xl+
   * the pill already reads "Synthetic · educational only", so a hover card
   * repeating the same sentence is noise — and it hangs over the page for
   * anyone whose cursor drifts through the top-right corner. It is also a
   * `role="note"`, which is not interactive, so touch users never get it
   * either way. The sr-only text below is what actually carries the full
   * disclaimer to assistive tech, on every breakpoint.
   */
  const wide = useMediaQuery('(min-width: 80rem)') // Tailwind `xl`

  const pill = (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber/30 bg-amber/10 px-2.5 py-1.5 text-[0.66rem] font-semibold text-amber"
      role="note"
    >
      <ShieldAlert size={12} aria-hidden="true" />
      <span className="hidden xl:inline">Synthetic · educational only</span>
      <span className="xl:hidden">Synthetic</span>
      {/* Always in the accessibility tree, even when visually shortened. */}
      <span className="sr-only">{SAFETY_DISCLAIMER}</span>
    </span>
  )

  return wide ? pill : <InfoTooltip label={SAFETY_DISCLAIMER}>{pill}</InfoTooltip>
}

/** Journey rail: Patient → Digital Twin → Models → Evidence → Synthesis → Safety. */
function JourneyBreadcrumb({ pathname }: { pathname: string }) {
  const activeIndex = stageIndexFor(pathname)
  return (
    <nav aria-label="Journey" className="hidden min-w-0 items-center gap-1 lg:flex">
      {JOURNEY.map((stage, i) => {
        const isActive = i === activeIndex
        const isPast = activeIndex > -1 && i < activeIndex
        return (
          <span key={stage.id} className="flex shrink-0 items-center gap-1">
            {i > 0 && <ChevronRight size={11} className="text-border-strong" aria-hidden="true" />}
            <NavLink
              to={stage.to}
              aria-current={isActive ? 'step' : undefined}
              className={`rounded-full px-2.5 py-1 text-[0.7rem] font-medium transition-colors ${
                isActive
                  ? 'bg-teal/12 font-semibold text-teal'
                  : isPast
                    ? 'text-ink-2 hover:text-ink'
                    : 'text-ink-3 hover:text-ink-2'
              }`}
            >
              {stage.label}
            </NavLink>
          </span>
        )
      })}
    </nav>
  )
}

/** Small-screen route menu — the journey rail collapses below `lg`. */
function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          id="app-mobile-nav"
          className="shell-glass fixed inset-x-0 top-14 z-40 overflow-hidden border-b border-border-strong lg:hidden"
          initial={reduced ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={reduced ? undefined : { height: 0, opacity: 0 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        >
          <nav aria-label="All screens" className="max-h-[70vh] overflow-y-auto p-3">
            {ROUTES.map((r) => (
              <NavLink
                key={r.to}
                to={r.to}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-colors ${
                    isActive ? 'bg-teal/12 font-semibold text-teal' : 'text-ink-2 hover:bg-subtle hover:text-ink'
                  }`
                }
              >
                <r.icon size={16} className="shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.label}</span>
                  <span className="block truncate text-[0.68rem] text-ink-3">{r.hint}</span>
                </span>
              </NavLink>
            ))}
          </nav>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * Application shell: a compact top command bar and a full-bleed content
 * area. There is no persistent side rail — secondary navigation is
 * contextual per screen via the `contextualNav` slot.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => setMenuOpen(false), [pathname])

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-page text-ink">
        {/* Sits above the page ground, below every content layer. */}
        <AnatomicalBackdrop />

        <a
          href="#main"
          className="sr-only rounded-[10px] bg-subtle px-4 py-2 text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:border focus:border-teal"
        >
          Skip to main content
        </a>

        <header className="shell-glass sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border-strong px-3 sm:px-5">
          <NavLink to="/" className="flex shrink-0 items-center gap-2.5" aria-label="MedGenesis home">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-teal to-blue text-white">
              <BRAND_ICON size={16} strokeWidth={2.6} />
            </span>
            <span className="hidden leading-none sm:block">
              <span className="block text-sm font-bold tracking-tight text-ink">MedGenesis</span>
              <span className="mt-0.5 block text-[0.58rem] tracking-[0.16em] text-ink-3 uppercase">
                Clinical Intelligence
              </span>
            </span>
          </NavLink>

          <span className="mx-1 hidden h-5 w-px shrink-0 bg-border-strong lg:block" aria-hidden="true" />

          <JourneyBreadcrumb pathname={pathname} />

          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-2.5">
            <PatientChip />
            <CommandPalette />
            <SafetyPill />
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="app-mobile-nav"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-border-strong text-ink-2 transition-colors hover:bg-subtle hover:text-ink lg:hidden"
            >
              {menuOpen ? <X size={16} /> : <Menu size={16} />}
            </button>
          </div>
        </header>

        <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />

        <main id="main" tabIndex={-1} className="relative z-10 outline-none">
          {children}
        </main>
      </div>
    </TooltipProvider>
  )
}

/**
 * Standard page container. `bleed` lets a stage header run full-width
 * while its body stays within the reading measure.
 */
export function PageContainer({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[86rem] px-4 sm:px-6 lg:px-10 ${className}`}>{children}</div>
}

/** Contextual (per-screen) secondary nav — replaces the persistent rail. */
export function ContextualNav({ children }: { children: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-center gap-2 border-b border-border-strong pb-4">{children}</div>
  )
}
