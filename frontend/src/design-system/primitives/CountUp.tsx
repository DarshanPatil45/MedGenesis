import { useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

/**
 * Animates a real number from 0 to its value once, on first appearance.
 *
 * Only ever renders the value it was given — this is a reveal of a real
 * figure, never a fabricated one. It settles on `value` exactly rather than
 * on an interpolated approximation, so the final frame is the true number.
 *
 * Honours `prefers-reduced-motion` by rendering the value immediately.
 */
export function CountUp({
  value,
  decimals = 0,
  duration = 900,
  prefix = '',
  suffix = '',
}: {
  value: number
  decimals?: number
  duration?: number
  prefix?: string
  suffix?: string
}) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(reduced ? value : 0)
  const ref = useRef<HTMLSpanElement>(null)
  const done = useRef(false)

  useEffect(() => {
    if (reduced || !Number.isFinite(value)) {
      setShown(value)
      return
    }
    // Re-animate when the underlying figure changes (new patient, new run).
    done.current = false

    const el = ref.current
    if (!el || typeof IntersectionObserver !== 'function') {
      setShown(value)
      return
    }

    let raf = 0
    const start = (t0: number) => {
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / duration)
        // easeOutCubic — fast arrival, soft landing.
        const eased = 1 - Math.pow(1 - p, 3)
        setShown(p === 1 ? value : value * eased)
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !done.current) {
            done.current = true
            start(performance.now())
            io.disconnect()
          }
        }
      },
      { threshold: 0.2 },
    )
    io.observe(el)

    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [value, duration, reduced])

  return (
    <span ref={ref}>
      {prefix}
      {shown.toFixed(decimals)}
      {suffix}
    </span>
  )
}
