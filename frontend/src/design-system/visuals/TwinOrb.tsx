import { motion, useReducedMotion } from 'motion/react'
import type { Patient } from '../../api/types'
import { color } from '../tokens'

// Fixed coordinates, not Math.random(), so the field is stable across
// re-renders and never re-lays-out on state change.
const PARTICLES: [number, number, number][] = [
  [46, 82, 1.1], [92, 46, 0.8], [130, 136, 1.3], [60, 182, 0.9], [198, 64, 1.2],
  [250, 122, 0.8], [216, 210, 1.3], [98, 238, 1.0], [268, 180, 0.9], [152, 36, 1.0],
  [32, 144, 0.8], [286, 96, 1.0], [174, 268, 1.1], [66, 258, 0.8], [252, 250, 1.0],
]

const NODE_ANGLES = [-62, 8, 76, 152, 214, 292]
/** Concentric tick marks — an instrument dial, not decoration. */
const TICKS = Array.from({ length: 48 }, (_, i) => i * 7.5)

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

/**
 * Ambient Digital Twin visual — a instrument-dial composition of
 * concentric orbits, a tick ring, an orbiting node field and a clinical
 * signal trace. SVG/CSS only (GPU-cheap: no canvas loop, no per-frame JS).
 *
 * Labels inside the dial come from the real `Patient` record. With no
 * patient selected it renders a dimmed, unlabelled empty state rather
 * than placeholder measurements.
 */
export function TwinOrb({ patient, className = '' }: { patient: Patient | null; className?: string }) {
  const reduced = useReducedMotion()
  const C = 160
  const on = !!patient

  return (
    <motion.svg
      viewBox="0 0 320 320"
      className={className}
      role="img"
      aria-label={
        patient
          ? `Digital Twin visual for patient ${patient.id}, age ${patient.age}, ${patient.sex}`
          : 'Digital Twin visual — no patient selected'
      }
      initial={reduced ? false : { opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
    >
      <defs>
        <radialGradient id="orb-core" cx="40%" cy="32%">
          <stop offset="0%" stopColor={color.tealBright} stopOpacity={on ? 0.16 : 0.05} />
          <stop offset="55%" stopColor={color.blueBright} stopOpacity={on ? 0.08 : 0.03} />
          <stop offset="100%" stopColor={color.blueBright} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="orb-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={color.teal} stopOpacity={on ? 0.85 : 0.3} />
          <stop offset="60%" stopColor={color.blue} stopOpacity={on ? 0.5 : 0.18} />
          <stop offset="100%" stopColor={color.blue} stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="orb-signal" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color.teal} stopOpacity="0" />
          <stop offset="25%" stopColor={color.teal} stopOpacity={on ? 0.95 : 0.25} />
          <stop offset="75%" stopColor={color.blue} stopOpacity={on ? 0.95 : 0.25} />
          <stop offset="100%" stopColor={color.blue} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* soft core wash */}
      <circle cx={C} cy={C} r="150" fill="url(#orb-core)" />

      {/* particle field */}
      {PARTICLES.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={color.tealBright} opacity={on ? 0.42 : 0.16} />
      ))}

      {/* instrument tick ring */}
      <g opacity={on ? 0.5 : 0.2}>
        {TICKS.map((a, i) => {
          const major = i % 6 === 0
          const [x1, y1] = polar(C, C, major ? 132 : 137, a)
          const [x2, y2] = polar(C, C, 142, a)
          return (
            <line
              key={a}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={major ? color.teal : color.ink3}
              strokeWidth={major ? 1.4 : 0.8}
              opacity={major ? 0.9 : 0.45}
            />
          )
        })}
      </g>

      {/* orbits */}
      <circle cx={C} cy={C} r="112" fill="none" stroke="url(#orb-ring)" strokeWidth="1.25" opacity={on ? 0.9 : 0.3} />
      <circle cx={C} cy={C} r="74" fill="none" stroke={color.blue} strokeWidth="0.9" strokeDasharray="3 6" opacity={on ? 0.4 : 0.15} />

      {/* connective chords */}
      <g opacity={on ? 0.22 : 0.08}>
        {NODE_ANGLES.map((a, i) => {
          const [x1, y1] = polar(C, C, 112, a)
          const [x2, y2] = polar(C, C, 112, NODE_ANGLES[(i + 2) % NODE_ANGLES.length])
          return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color.teal} strokeWidth="0.75" />
        })}
      </g>

      {/* clinical signal trace */}
      <path
        d="M16 160 H94 l9-24 10 46 11-60 12 76 10-40 9 14 h36 l8-16 9 30 8-14 h82"
        fill="none"
        stroke="url(#orb-signal)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* orbit nodes */}
      {NODE_ANGLES.map((a, i) => {
        const [x, y] = polar(C, C, 112, a)
        return (
          <motion.g
            key={a}
            initial={reduced ? false : { opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: reduced ? 0 : 0.45 + i * 0.08, duration: 0.5 }}
            style={{ transformOrigin: `${x}px ${y}px` }}
          >
            <circle cx={x} cy={y} r="7" fill={color.surface} stroke={color.teal} strokeWidth="1.2" opacity={on ? 1 : 0.35} />
            <circle cx={x} cy={y} r="2.6" fill={color.teal} opacity={on ? 0.95 : 0.3} />
          </motion.g>
        )
      })}

      {/* readout — real fields only */}
      {patient ? (
        <g textAnchor="middle">
          <text x={C} y={C - 14} fill={color.teal} fontSize="10.5" fontFamily="JetBrains Mono, monospace" letterSpacing="2.4">
            #{patient.id}
          </text>
          <text x={C} y={C + 16} fill={color.ink} fontSize="27" fontFamily="Inter, sans-serif" fontWeight="700">
            {patient.age}
          </text>
          <text x={C} y={C + 35} fill={color.ink3} fontSize="9.5" fontFamily="Inter, sans-serif" letterSpacing="1.6">
            {patient.sex.toUpperCase()}
          </text>
        </g>
      ) : (
        <g textAnchor="middle">
          <circle cx={C} cy={C} r="5" fill="none" stroke={color.ink3} strokeWidth="1" />
          <text x={C} y={C + 34} fill={color.ink3} fontSize="9" fontFamily="Inter, sans-serif" letterSpacing="2.2">
            NO TWIN LOADED
          </text>
        </g>
      )}
    </motion.svg>
  )
}
