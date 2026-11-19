import { useReducedMotion } from 'motion/react'
import { color } from '../tokens'

/**
 * Page-level ambient backdrop: a deterministic isoline field.
 *
 * Reads as medical-imaging terrain — the contour language of a risk
 * surface, which is literally what this product computes — without
 * depicting a specific organ. Drawn entirely in SVG so it is ours,
 * scales to any viewport, and costs no image bytes.
 *
 * Contrast safety: every stroke sits at =3.5% alpha over the page
 * ground, and all data surfaces paint solid `--color-surface` on top.
 * Measured text contrast is unchanged from the flat background.
 *
 * Deterministic by construction — no Math.random(), so the composition
 * is identical on every render and across SSR/hydration.
 */

/** One closed contour: a circle perturbed by three low-frequency waves. */
function contourPath(cx: number, cy: number, r: number, seed: number, steps = 168): string {
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const wobble =
      Math.sin(t * 3 + seed) * 0.1 +
      Math.sin(t * 2 - seed * 1.7) * 0.068 +
      Math.sin(t * 5 + seed * 0.6) * 0.032
    const rr = r * (1 + wobble)
    // Anisotropic scaling keeps the forms organic rather than circular.
    const x = cx + Math.cos(t) * rr * 1.14
    const y = cy + Math.sin(t) * rr * 0.84
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return `${d}Z`
}

function ContourField({
  cx,
  cy,
  stroke,
  rings = 11,
  base = 46,
  step = 34,
  phase = 0,
}: {
  cx: number
  cy: number
  stroke: string
  rings?: number
  base?: number
  step?: number
  phase?: number
}) {
  return (
    <g fill="none" stroke={stroke} strokeWidth={1.1}>
      {Array.from({ length: rings }, (_, i) => (
        <path
          key={i}
          d={contourPath(cx, cy, base + i * step, phase + i * 0.42)}
          // Outer rings fade — the field dissolves instead of ending.
          opacity={0.34 - i * 0.026}
        />
      ))}
    </g>
  )
}

export function AnatomicalBackdrop() {
  const reduced = useReducedMotion()

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <svg
        className={reduced ? undefined : 'ambient-drift'}
        width="100%"
        height="100%"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        style={{ animationDuration: '46s' }}
      >
        <defs>
          <radialGradient id="backdrop-warm" cx="14%" cy="8%" r="62%">
            <stop offset="0%" stopColor={color.tealBright} stopOpacity={0.1} />
            <stop offset="100%" stopColor={color.tealBright} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="backdrop-cool" cx="88%" cy="94%" r="58%">
            <stop offset="0%" stopColor={color.blueBright} stopOpacity={0.09} />
            <stop offset="100%" stopColor={color.blueBright} stopOpacity={0} />
          </radialGradient>
          {/* Feathers the field toward the centre so content never fights it. */}
          <radialGradient id="backdrop-vignette" cx="50%" cy="46%" r="58%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0} />
            <stop offset="62%" stopColor="#ffffff" stopOpacity={0.55} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity={0.9} />
          </radialGradient>
        </defs>

        <rect width="1440" height="900" fill="url(#backdrop-warm)" />
        <rect width="1440" height="900" fill="url(#backdrop-cool)" />

        <ContourField cx={168} cy={104} stroke={color.teal} phase={0.3} />
        <ContourField cx={1298} cy={812} stroke={color.blue} phase={2.1} rings={10} step={36} />

        <rect width="1440" height="900" fill="url(#backdrop-vignette)" />
      </svg>
    </div>
  )
}
