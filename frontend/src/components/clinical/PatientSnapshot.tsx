import { FlaskConical, ShieldCheck, ShieldOff } from 'lucide-react'
import type { Patient } from '../../api/types'

/**
 * Compact patient-context strip — every field comes straight off the
 * `Patient` record (id/pseudonym/age/sex/screening_eligible/is_synthetic).
 * There is no "history completeness" field in the API, so this never shows
 * one; screening eligibility and synthetic-data status are the only real
 * flags the backend actually exposes.
 */
export function PatientSnapshot({ patient }: { patient: Patient }) {
  return (
    <div className="patient-snapshot">
      <span className="patient-snapshot-id">PATIENT #{patient.id}</span>
      <span className="patient-snapshot-name">{patient.pseudonym}</span>
      <span className="patient-snapshot-meta muted">
        {patient.age} · {patient.sex}
      </span>
      <span className={`patient-snapshot-flag${patient.screening_eligible ? '' : ' off'}`}>
        {patient.screening_eligible ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}
        {patient.screening_eligible ? 'Screening eligible' : 'Not screening-eligible'}
      </span>
      {patient.is_synthetic && (
        <span className="patient-snapshot-flag synthetic">
          <FlaskConical size={12} />
          Synthetic demo data
        </span>
      )}
    </div>
  )
}
