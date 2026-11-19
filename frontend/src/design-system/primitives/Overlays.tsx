import * as Popover from '@radix-ui/react-popover'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import * as Slider from '@radix-ui/react-slider'
import * as Tabs from '@radix-ui/react-tabs'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { cn } from '../cn'

/* ── Tooltip ──────────────────────────────────────────────────────── */

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <Tooltip.Provider delayDuration={200}>{children}</Tooltip.Provider>
}

export function InfoTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="z-50 max-w-xs rounded-[10px] border border-border-strong bg-subtle px-3 py-2 text-xs leading-relaxed text-ink shadow-lg"
        >
          {label}
          <Tooltip.Arrow className="fill-white" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/* ── Tabs ─────────────────────────────────────────────────────────── */

export const TabsRoot = Tabs.Root
export const TabsContent = Tabs.Content

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Tabs.List
      className={cn('inline-flex gap-1 rounded-full border border-border-strong bg-surface p-1', className)}
    >
      {children}
    </Tabs.List>
  )
}

export function TabTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <Tabs.Trigger
      value={value}
      className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-ink-2 transition-colors data-[state=active]:bg-subtle data-[state=active]:text-teal hover:text-ink"
    >
      {children}
    </Tabs.Trigger>
  )
}

/* ── Popover ──────────────────────────────────────────────────────── */

export const PopoverRoot = Popover.Root
export const PopoverTrigger = Popover.Trigger

export function PopoverPanel({
  children,
  align = 'end',
  className,
}: {
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  className?: string
}) {
  return (
    <Popover.Portal>
      <Popover.Content
        align={align}
        sideOffset={8}
        className={cn(
          'z-50 rounded-[14px] border border-border-strong bg-subtle p-3 shadow-2xl outline-none',
          className,
        )}
      >
        {children}
      </Popover.Content>
    </Popover.Portal>
  )
}

/* ── Scroll area ──────────────────────────────────────────────────── */

export function HScrollArea({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ScrollArea.Root className={cn('w-full min-w-0 max-w-full overflow-hidden', className)} type="hover">
      <ScrollArea.Viewport className="w-full [&>div]:!block">{children}</ScrollArea.Viewport>
      <ScrollArea.Scrollbar
        orientation="horizontal"
        className="flex h-2 touch-none p-0.5 select-none"
      >
        <ScrollArea.Thumb className="rounded-full bg-border-strong" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  )
}

/* ── Slider ───────────────────────────────────────────────────────── */

export function LabeledSlider({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = '',
  hint,
}: {
  id: string
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  unit?: string
  hint?: string
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-ink-2">
          {label}
        </label>
        <span className="font-mono text-sm font-semibold text-ink tabular-nums">
          {value > 0 ? '+' : ''}
          {value}
          {unit}
        </span>
      </div>
      <Slider.Root
        className="relative flex h-5 w-full touch-none items-center select-none"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
      >
        <Slider.Track className="relative h-1.5 w-full grow rounded-full bg-border-strong">
          <Slider.Range className="absolute h-full rounded-full bg-gradient-to-r from-teal to-blue" />
        </Slider.Track>
        <Slider.Thumb
          id={id}
          aria-label={`${label}${unit ? ` (${unit.trim()})` : ''}`}
          className="block h-4 w-4 rounded-full border-2 border-white bg-teal shadow-md transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
        />
      </Slider.Root>
      {hint && <p className="mt-1.5 text-[0.68rem] text-ink-3">{hint}</p>}
    </div>
  )
}
