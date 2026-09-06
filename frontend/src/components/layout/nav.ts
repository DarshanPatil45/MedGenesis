import {
  ClipboardList,
  FlaskConical,
  Gauge,
  History,
  MessageSquare,
  ShieldCheck,
  Stethoscope,
  UserPlus,
} from 'lucide-react'
import type { ComponentType } from 'react'

export interface NavItem {
  to: string
  label: string
  end?: boolean
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Patient',
    items: [
      { to: '/', label: 'Patient Intake', end: true, icon: UserPlus },
      { to: '/timeline', label: 'Digital Twin Timeline', icon: History },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { to: '/screening', label: 'Screening Dashboard', icon: Gauge },
      { to: '/clinical-analysis', label: 'Clinical Analysis', icon: Stethoscope },
      { to: '/simulator', label: 'What-if Simulator', icon: FlaskConical },
    ],
  },
  {
    label: 'Care',
    items: [
      { to: '/careplan', label: 'Care Plan', icon: ClipboardList },
      { to: '/chat', label: 'Chat', icon: MessageSquare },
    ],
  },
  {
    label: 'System',
    items: [{ to: '/trace', label: 'Agent Trace & Safety', icon: ShieldCheck }],
  },
]

// Flat view — used to look up the current page's label by route, without
// callers needing to know about the group structure.
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)
