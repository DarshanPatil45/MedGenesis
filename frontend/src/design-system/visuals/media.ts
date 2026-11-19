import { useEffect, useState } from 'react'

/**
 * Image slots.
 *
 * Photography is configured by FILENAME, not by code: drop a file at the
 * listed path in `public/media/` and it appears; delete it and the UI
 * closes over the gap. Adding or swapping an image never requires an edit
 * here — this table only names the slots and their alt text.
 *
 * Alt text lives with the slot rather than the call site so a swapped
 * photo can never inherit a description of the picture it replaced.
 */
export const MEDIA = {
  'intake-context': {
    src: '/media/intake-context.jpg',
    alt: 'A capillary blood glucose test being taken from a fingertip.',
  },
  nutrition: {
    src: '/media/nutrition.jpg',
    alt: 'Green vegetables and fruit — broccoli, apple, pepper, lime, kiwi — beside a glass of green juice.',
  },
  activity: {
    src: '/media/activity.jpg',
    alt: 'A row of treadmills and rowing machines beside a window in a daylit gym.',
  },
  monitoring: {
    src: '/media/monitoring.jpg',
    alt: 'A blood-glucose meter and diabetes self-monitoring supplies.',
  },
} as const

export type MediaSlot = keyof typeof MEDIA

/**
 * Reports which of the requested slots actually have a file behind them.
 *
 * Care Plan renders its domain strip as an all-or-nothing row: one photo
 * beside two empty frames reads as a broken layout, so the group is only
 * shown once every slot resolves. Probing is done with `Image()` rather
 * than `fetch` to reuse the browser's own image cache — the later <img>
 * render is then a cache hit, not a second request.
 */
export function useAvailableMedia(slots: readonly MediaSlot[]) {
  const [available, setAvailable] = useState<Set<MediaSlot>>(new Set())
  const [settled, setSettled] = useState(false)

  // Slots are compile-time constants; join for a stable dependency.
  const key = slots.join(',')

  useEffect(() => {
    let cancelled = false
    const found = new Set<MediaSlot>()

    void Promise.all(
      slots.map(
        (slot) =>
          new Promise<void>((resolve) => {
            const img = new Image()
            img.onload = () => {
              found.add(slot)
              resolve()
            }
            img.onerror = () => resolve()
            img.src = MEDIA[slot].src
          }),
      ),
    ).then(() => {
      if (cancelled) return
      setAvailable(found)
      setSettled(true)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return {
    available,
    settled,
    /** True only when every requested slot has a file. */
    complete: settled && slots.every((s) => available.has(s)),
  }
}
