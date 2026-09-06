import { CircleAlert, ShieldCheck } from 'lucide-react'
import { usePatients } from '../../PatientContext'

/**
 * Persistent command-center context strip, visible under the header on
 * every page. Every field comes straight off the `Patient` record — there
 * is no "history completeness" field in the API, so this never invents
 * one; screening eligibility is the only real completeness-adjacent flag
 * the backend exposes. "Digital Twin Active" is shown whenever a patient
 * is selected, since every patient in this system has one by construction
 * (it is a computed view over that patient's own event timeline) — not a
 * status that could independently be false.
 */
export function PatientContextBar() {
  const { selected } = usePatients()
  if (!selected) return null

  return (
    <div className="patient-context-bar">
      <span className="patient-context-bar-id">PATIENT #{selected.id}</span>
      <span className="patient-context-bar-name">{selected.pseudonym}</span>
      <span className="muted" style={{ fontSize: '0.78rem' }}>
        {selected.age} · {selected.sex}
      </span>
      <span className={`patient-context-bar-flag${selected.screening_eligible ? '' : ' warn'}`}>
        {selected.screening_eligible ? <ShieldCheck size={12} /> : <CircleAlert size={12} />}
        {selected.screening_eligible ? 'Screening eligible' : 'Incomplete history'}
      </span>
      <span className="patient-context-bar-twin">Digital Twin Active</span>
    </div>
  )
}
