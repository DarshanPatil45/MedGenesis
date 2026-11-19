/**
 * MedGenesis design tokens — clinical light.
 *
 * Mirrored into Tailwind via the `@theme` block in `src/index.css`
 * (Tailwind v4 is CSS-first; there is no tailwind.config.js). This module
 * exists so non-CSS consumers — Recharts series, SVG gradients — read the
 * same values instead of hardcoding hexes.
 *
 * Two variants per accent:
 *   base   — AA-contrast on white, safe for TEXT and small marks.
 *   bright — saturated, for FILLS: chart series, gauges, bars.
 */

export const color = {
  /* Surfaces */
  page: '#F4F7FB',
  surface: '#FFFFFF',
  subtle: '#F7F9FC',
  borderStrong: '#DBE3EE',
  border: '#E8EDF5',

  /* Text */
  ink: '#0B1220',
  ink2: '#3A4759',
  ink3: '#5B6880',

  /* Accent primary */
  teal: '#0B6E63',
  tealBright: '#15B79E',
  blue: '#1349B8',
  blueBright: '#2E90FA',

  /* Accent secondary */
  violet: '#6938EF',
  violetBright: '#875BF7',
  amber: '#B54708',
  amberBright: '#F79009',
  rose: '#C01048',
  roseBright: '#F04438',
} as const

/** Locked primary gradient — teal → blue. CTAs and one key metric only. */
export const gradient = {
  primary: `linear-gradient(120deg, ${color.teal} 0%, ${color.blue} 90%)`,
} as const

export const radius = { card: '14px', input: '10px', pill: '999px' } as const

export const motionTiming = {
  micro: 0.22,
  microFast: 0.18,
  microSlow: 0.26,
  hero: 0.5,
  heroSlow: 0.6,
} as const

export const easing = {
  out: [0.22, 1, 0.36, 1] as const,
  inOut: [0.65, 0, 0.35, 1] as const,
}

/**
 * Risk tier → colour, keyed by the backend's own `risk_tier` string
 * ("Low" | "Moderate" | "High"). Never derived from a raw probability
 * in the frontend.
 */
export const riskColor: Record<string, string> = {
  low: color.teal,
  moderate: color.amber,
  high: color.rose,
}

/** Saturated siblings for gauge arcs and chart fills. */
export const riskFill: Record<string, string> = {
  low: color.tealBright,
  moderate: color.amberBright,
  high: color.roseBright,
}

/** Safety verdict → colour, keyed by `SafetyOut.status`. */
export const safetyColor: Record<string, string> = {
  APPROVED: color.teal,
  FLAGGED_FOR_CLINICIAN_REVIEW: color.amber,
  BLOCKED: color.rose,
}

/** Digital Twin timeline lanes, keyed by real backend `event_type`. */
export const eventColor: Record<string, string> = {
  measurement: color.tealBright,
  lab_result: color.blueBright,
  medication_change: color.violetBright,
  lifestyle_log: '#5FD4C0',
  screening: color.amberBright,
  care_plan: color.ink3,
  note: '#94A3B8',
}

/** Shared Recharts styling so every chart in the app reads identically. */
export const chart = {
  grid: color.border,
  axis: color.ink3,
  tooltip: {
    background: color.surface,
    border: `1px solid ${color.borderStrong}`,
    borderRadius: radius.card,
    boxShadow: '0 12px 16px -4px rgb(16 24 40 / 0.10), 0 4px 6px -2px rgb(16 24 40 / 0.04)',
    fontSize: '0.8rem',
    color: color.ink,
  },
} as const

/** The disclaimer required on every route. Single source — do not retype. */
export const SAFETY_DISCLAIMER =
  'Synthetic data. Educational use only. Not medical advice or a diagnostic device.'
