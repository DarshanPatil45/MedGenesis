import { CalendarPlus, Pencil } from 'lucide-react'
import type { Patient } from '../../api/types'
import { Button } from '../../design-system'

/**
 * The slim identity strip at the top of the Digital Twin — who this
 * patient is and the two ways to change their record. Deliberately not
 * where model-readiness or feature-mapping detail lives; that's
 * secondary, technical information and belongs in the Advanced section
 * further down, not competing with "who is this and can I edit them".
 */
export function PatientHeader({
  patient,
  lastUpdatedAt,
  onEdit,
  onRecordEvent,
}: {
  patient: Patient
  lastUpdatedAt: string | null
  onEdit: () => void
  onRecordEvent: () => void
}) {
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-6 border-b border-border-strong pb-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink sm:text-3xl">{patient.pseudonym}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-3">
          <span>{patient.age} yrs</span>
          <span aria-hidden="true">·</span>
          <span className="capitalize">{patient.sex}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">Patient #{patient.id}</span>
          {lastUpdatedAt && (
            <>
              <span aria-hidden="true">·</span>
              <span>Updated {new Date(lastUpdatedAt).toLocaleDateString()}</span>
            </>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={onRecordEvent}>
          <CalendarPlus size={15} /> Record event
        </Button>
        <Button variant="primary" onClick={onEdit}>
          <Pencil size={15} /> Edit patient
        </Button>
      </div>
    </div>
  )
}
