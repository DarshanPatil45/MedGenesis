import { useEffect, useState } from 'react'

/**
 * Subscribes to a CSS media query from JS.
 *
 * For the rare case where a breakpoint must change *what renders*, not just
 * how it looks — CSS alone cannot unmount a React component. Prefer Tailwind
 * responsive classes for everything else.
 *
 * Returns `false` wherever `matchMedia` is unavailable (jsdom under test, SSR),
 * so callers must treat `false` as "assume narrow" rather than a real answer.
 */
export function useMediaQuery(query: string): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  const [matches, setMatches] = useState(() => (supported ? window.matchMedia(query).matches : false))

  useEffect(() => {
    if (!supported) return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    // Sync once: the query may have changed between render and effect.
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query, supported])

  return matches
}
