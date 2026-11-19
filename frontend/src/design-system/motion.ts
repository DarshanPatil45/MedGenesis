import type { Transition, Variants } from 'motion/react'
import { easing, motionTiming } from './tokens'

/**
 * Shared motion presets. Every consumer pairs these with
 * `useReducedMotion()` and passes `false` as `initial` when reduced
 * motion is requested, so nothing animates for those users.
 */

export const microTransition: Transition = {
  duration: motionTiming.micro,
  ease: easing.out,
}

export const heroTransition: Transition = {
  duration: motionTiming.hero,
  ease: easing.out,
}

/** Panel / drawer slide — spring, per the locked motion spec. */
export const panelSpring: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 34,
  mass: 0.9,
}

/** Page stage header reveal. */
export const stageReveal: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: heroTransition },
}

/** Staggered children for lists of cards / chips. */
export const staggerParent: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.055, delayChildren: 0.05 } },
}

export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: motionTiming.microSlow, ease: easing.out } },
}

/** Fade+lift used for result surfaces appearing after a fetch. */
export const resultReveal: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: heroTransition },
}

/**
 * Helper: returns `false` (motion's "no initial state") when the user
 * prefers reduced motion, otherwise the given variant name.
 */
export function initialFor(reduced: boolean | null, value: string | object = 'hidden') {
  return reduced ? false : value
}
