import * as Dialog from '@radix-ui/react-dialog'
import { CornerDownLeft, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../design-system/cn'
import { usePatients } from '../PatientContext'
import { ROUTES } from './journey'

/**
 * Command palette — ⌘K / Ctrl-K from anywhere.
 *
 * Client-side only, over data already in memory: the loaded patient list and
 * the app's own routes. There is deliberately no network call — the backend
 * exposes no general search endpoint (`/api/evidence/search` searches
 * evidence text only), so querying the server would either return the wrong
 * thing or require an endpoint that does not exist.
 *
 * Results are grouped for reading but indexed flat for keyboard travel, so
 * ↑/↓ crosses group boundaries the way every real palette does.
 */

type Item = {
  id: string
  group: 'Patients' | 'Screens'
  label: string
  meta?: string
  hint?: string
  /** Matches the icon type `ROUTES` declares in journey.ts. */
  icon?: ComponentType<{ size?: number; className?: string }>
  badge?: string
  run: () => void | Promise<void>
}

/**
 * Match quality, 0 = no match. Higher sorts first.
 *
 * Subsequence matching alone is far too generous on real data: "dtw" is a
 * genuine subsequence of "Demo Patient A (lower risk)", which buried
 * "Digital Twin" under five patients. Scoring keeps the loose matching
 * (so "dtw" still finds Digital Twin) while ranking literal hits above it.
 */
function score(haystack: string, needle: string): number {
  if (!needle) return 1
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()

  if (h.startsWith(n)) return 4

  // Initialism — "cp" → "Care Plan". Checked before the generic boundary
  // rule because greedy subsequence otherwise lets an unrelated entry that
  // merely contains the letters outrank the thing the user abbreviated.
  const initials = h
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
  if (initials.startsWith(n)) return 3.5

  // Match at a word boundary — "twin" in "Digital Twin".
  if (new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(h)) return 3
  if (h.includes(n)) return 2

  /*
   * Subsequence, weighted by how many characters land on a word boundary.
   * A flat subsequence score ties "dtw" against both "Digital Twin" and
   * "Demo Patient A (lower risk)"; the boundary weight is what makes the
   * initialism resolve to the screen. Capped below 2 so any literal
   * substring match still outranks every subsequence match.
   */
  let i = 0
  let onBoundary = 0
  for (let k = 0; k < h.length && i < n.length; k++) {
    if (h[k] === n[i]) {
      if (k === 0 || !/[a-z0-9]/.test(h[k - 1])) onBoundary++
      i++
    }
  }
  return i === n.length ? 1 + (onBoundary / n.length) * 0.9 : 0
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const { patients, selectPatient, selected } = usePatients()
  const navigate = useNavigate()
  const listRef = useRef<HTMLDivElement>(null)

  // Global shortcut. Capture phase so it wins over any field-level handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const items = useMemo<Item[]>(() => {
    const needle = q.trim()

    const rank = <T,>(rows: T[], text: (row: T) => string) =>
      rows
        .map((row) => ({ row, s: score(text(row), needle) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s)

    const patientItems = rank(patients, (p) => `${p.pseudonym} ${p.id}`)
      .slice(0, 6)
      .map(({ row: p, s }) => ({
        s,
        item: {
          id: `patient-${p.id}`,
          group: 'Patients' as const,
          label: p.pseudonym,
          meta: `#${p.id}`,
          hint: `${p.age} · ${p.sex}`,
          badge: selected?.id === p.id ? 'Active' : undefined,
          run: () => selectPatient(p.id),
        },
      }))

    const routeItems = rank(ROUTES, (r) => `${r.label} ${r.hint}`).map(({ row: r, s }) => ({
      s,
      item: {
        id: `route-${r.to}`,
        group: 'Screens' as const,
        label: r.label,
        hint: r.hint,
        icon: r.icon,
        run: () => navigate(r.to),
      },
    }))

    // Whichever group holds the single best match leads. Without this a weak
    // subsequence hit on a patient outranks a literal hit on a screen.
    const best = (rows: { s: number }[]) => (rows.length ? rows[0].s : 0)
    const groups =
      best(routeItems) > best(patientItems) ? [routeItems, patientItems] : [patientItems, routeItems]

    return groups.flat().map((r) => r.item)
  }, [q, patients, selected, selectPatient, navigate])

  // Keep the cursor in range as results shrink under typing.
  useEffect(() => setActive((i) => Math.min(i, Math.max(0, items.length - 1))), [items.length])

  useEffect(() => {
    if (!open) return
    setQ('')
    setActive(0)
  }, [open])

  // Follow the cursor without yanking the whole page.
  // jsdom implements neither scrollIntoView nor scrollTo, so feature-detect.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]')
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [active])

  const runItem = useCallback(
    (item: Item | undefined) => {
      if (!item) return
      item.run()
      setOpen(false)
    },
    [],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (items.length ? (i + 1) % items.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runItem(items[active])
    }
  }

  let lastGroup: string | null = null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
        aria-keyshortcuts="Meta+K Control+K"
        className="hidden shrink-0 items-center gap-2 rounded-full border border-border-strong bg-surface px-3 py-1.5 text-xs text-ink-3 transition-colors hover:border-ink-3 hover:text-ink-2 sm:flex"
      >
        <Search size={13} />
        <span className="hidden lg:inline">Find…</span>
        <kbd className="hidden rounded border border-border-strong bg-subtle px-1.5 py-0.5 font-mono text-[0.6rem] text-ink-3 lg:inline">
          ⌘K
        </kbd>
      </button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/25 backdrop-blur-[2px]" />
          <Dialog.Content
            onKeyDown={onKeyDown}
            className="data-surface-raised fixed top-[12vh] left-1/2 z-50 w-[min(94vw,34rem)] -translate-x-1/2 overflow-hidden rounded-[14px] p-0"
          >
            <Dialog.Title className="sr-only">Find a patient or screen</Dialog.Title>
            <Dialog.Description className="sr-only">
              Type to filter. Use the up and down arrow keys to move between results and Enter to choose.
            </Dialog.Description>

            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <Search size={15} className="shrink-0 text-ink-3" aria-hidden="true" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a patient or screen…"
                aria-label="Find a patient or screen"
                aria-controls="palette-results"
                aria-activedescendant={items[active]?.id}
                className="w-full bg-transparent py-3.5 text-sm text-ink outline-none placeholder:text-ink-3"
              />
            </div>

            <div ref={listRef} id="palette-results" role="listbox" aria-label="Results" className="max-h-[22rem] overflow-y-auto p-2">
              {items.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-ink-3">
                  No patient or screen matches “{q}”.
                </p>
              )}

              {items.map((item, i) => {
                const header = item.group !== lastGroup ? item.group : null
                lastGroup = item.group
                const isActive = i === active
                const Icon = item.icon
                return (
                  <div key={item.id}>
                    {header && (
                      <p className="px-2 pt-2 pb-1.5 text-[0.6rem] font-bold tracking-[0.16em] text-ink-3 uppercase">
                        {header}
                      </p>
                    )}
                    <div
                      id={item.id}
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive}
                      onMouseMove={() => setActive(i)}
                      onClick={() => runItem(item)}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-2',
                        isActive ? 'bg-teal/10 text-ink' : 'text-ink-2',
                      )}
                    >
                      {item.meta ? (
                        <span className="shrink-0 font-mono text-[0.68rem] text-teal">{item.meta}</span>
                      ) : Icon ? (
                        <Icon size={14} className="shrink-0 text-ink-3" aria-hidden="true" />
                      ) : null}

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{item.label}</span>
                        {item.hint && <span className="block truncate text-[0.68rem] text-ink-3">{item.hint}</span>}
                      </span>

                      {item.badge && (
                        <span className="shrink-0 rounded-full bg-teal/12 px-2 py-0.5 text-[0.6rem] font-semibold text-teal">
                          {item.badge}
                        </span>
                      )}
                      {isActive && <CornerDownLeft size={13} className="shrink-0 text-ink-3" aria-hidden="true" />}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-4 border-t border-border bg-subtle px-4 py-2 text-[0.62rem] text-ink-3">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border-strong bg-surface px-1 font-mono">↑</kbd>
                <kbd className="rounded border border-border-strong bg-surface px-1 font-mono">↓</kbd> move
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border-strong bg-surface px-1 font-mono">↵</kbd> select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border-strong bg-surface px-1 font-mono">esc</kbd> close
              </span>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
