import type { Safety } from '../api/types'

const LABELS: Record<string, string> = {
  APPROVED: 'Safety review: approved',
  FLAGGED_FOR_CLINICIAN_REVIEW: 'Flagged for clinician review',
  BLOCKED: 'Blocked by the safety layer',
}

const CLASSES: Record<string, string> = {
  APPROVED: 'approved',
  FLAGGED_FOR_CLINICIAN_REVIEW: 'flagged',
  BLOCKED: 'blocked',
}

export function SafetyBanner({ safety }: { safety: Safety }) {
  return (
    <div className={`banner ${CLASSES[safety.status] ?? 'approved'}`}>
      <strong>{LABELS[safety.status] ?? safety.status}</strong>{' '}
      <span className="muted">(policy v{safety.policy_version})</span>
      {safety.banner && <div style={{ marginTop: '0.35rem' }}>{safety.banner}</div>}
      {safety.reasons.length > 0 && (
        <ul>
          {safety.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ScopeDisclaimer({ text }: { text?: string | null }) {
  return (
    <div className="banner disclaimer">
      <strong>Educational prototype — not medical advice, not a diagnostic device.</strong>
      <div style={{ marginTop: '0.3rem' }}>
        {text ??
          "The screening baseline is trained on the CDC's 2015 BRFSS Diabetes Health Indicators survey — self-reported data from US adults, not lab results or a diagnosis. It cannot be used as a clinical Type 2 Diabetes predictor. Discuss any health decision with a qualified clinician."}
      </div>
    </div>
  )
}
