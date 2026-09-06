import { Ban, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ComponentType } from 'react'
import type { Safety } from '../../api/types'
import { SafetyBanner } from '../SafetyBanner'

const ICON: Record<string, ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  APPROVED: ShieldCheck,
  FLAGGED_FOR_CLINICIAN_REVIEW: ShieldAlert,
  BLOCKED: Ban,
}

const ICON_COLOR: Record<string, string> = {
  APPROVED: 'var(--low)',
  FLAGGED_FOR_CLINICIAN_REVIEW: 'var(--moderate)',
  BLOCKED: 'var(--high)',
}

/**
 * The final system gate — every LangGraph route ends at the Safety Agent,
 * so every result on every page closes with this. The verdict text and
 * reasons are still rendered entirely by SafetyBanner (independently
 * tested, untouched here); this only adds the icon and "system gate"
 * framing around it.
 */
export function SafetyStatus({ safety }: { safety: Safety }) {
  const Icon = ICON[safety.status] ?? ShieldCheck
  return (
    <div className="safety-status">
      <span className="micro-label">System safety gate</span>
      <div className="safety-status-body">
        <Icon size={22} className="safety-status-icon" style={{ color: ICON_COLOR[safety.status] ?? ICON_COLOR.APPROVED }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <SafetyBanner safety={safety} />
        </div>
      </div>
    </div>
  )
}
