import {
  Activity,
  ClipboardList,
  FlaskConical,
  Gauge,
  MessageSquare,
  ShieldCheck,
  UserPlus,
  Waypoints,
  Workflow,
} from 'lucide-react'
import type { ComponentType } from 'react'

export interface RouteDef {
  to: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  /** Short description used by the command-bar finder. */
  hint: string
}

/**
 * Every route in the app. Used by the finder and mobile menu.
 *
 * `/trace` stays registered and reachable here (and from Safety →
 * Advanced) even though it isn't one of the 7 primary journey stages
 * below — normal use of the app never requires understanding the
 * underlying agent pipeline, but the trace is never hidden from anyone
 * who goes looking for it.
 */
export const ROUTES: RouteDef[] = [
  { to: '/', label: 'Patients', icon: UserPlus, hint: 'Create or select a synthetic patient' },
  { to: '/twin', label: 'Digital Twin', icon: Waypoints, hint: 'Patient record, trends and longitudinal history' },
  { to: '/assessment', label: 'Assessment', icon: Gauge, hint: 'Risk screening, key factors and evidence' },
  { to: '/simulator', label: 'What-if', icon: FlaskConical, hint: 'Simulate scenarios without changing the twin' },
  { to: '/careplan', label: 'Care Plan', icon: ClipboardList, hint: 'Lifestyle recommendations with citations' },
  { to: '/chat', label: 'Assistant', icon: MessageSquare, hint: 'Ask questions grounded in cited sources' },
  { to: '/safety', label: 'Safety', icon: ShieldCheck, hint: 'Audit log and active policy' },
  { to: '/trace', label: 'Agent Trace', icon: Workflow, hint: 'Step-by-step agent execution' },
]

export interface JourneyStage {
  id: string
  label: string
  /** Primary destination for the stage. */
  to: string
  /** Every route that belongs to this stage (drives the active state). */
  routes: string[]
}

/**
 * The product's journey framing, strictly the patient journey — never the
 * backend architecture: Patients → Digital Twin → Assessment → What-if →
 * Care Plan → Assistant → Safety. Screening, Clinical Analysis and
 * Evidence are not separate stops; they're merged into Assessment so a
 * user never has to know there were 8 agents and 2 models behind it.
 *
 * INVARIANT: every stage's `to` must be one of its own `routes`. Otherwise
 * clicking the stage lands somewhere that highlights a *different* stage,
 * and the control reads as broken. `synthesis` previously pointed at
 * `/clinical-analysis` while claiming `/careplan`, so it navigated to the
 * Evidence stage and left `/careplan` unreachable from the breadcrumb.
 * `journey.test.ts` enforces this.
 */
export const JOURNEY: JourneyStage[] = [
  { id: 'patients', label: 'Patients', to: '/', routes: ['/'] },
  { id: 'twin', label: 'Digital Twin', to: '/twin', routes: ['/twin'] },
  { id: 'assessment', label: 'Assessment', to: '/assessment', routes: ['/assessment'] },
  { id: 'whatif', label: 'What-if', to: '/simulator', routes: ['/simulator'] },
  { id: 'careplan', label: 'Care Plan', to: '/careplan', routes: ['/careplan'] },
  { id: 'assistant', label: 'Assistant', to: '/chat', routes: ['/chat'] },
  { id: 'safety', label: 'Safety', to: '/safety', routes: ['/safety', '/trace'] },
]

export const BRAND_ICON = Activity

/** Index of the stage that owns a given pathname, or -1. */
export function stageIndexFor(pathname: string): number {
  return JOURNEY.findIndex((s) => s.routes.includes(pathname))
}

export function routeFor(pathname: string): RouteDef | undefined {
  return ROUTES.find((r) => r.to === pathname)
}
