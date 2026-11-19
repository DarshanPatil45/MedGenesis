import { Pill } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api/client'
import type { TimelineEvent } from '../../api/types'
import { Button, ChipButton, Drawer, SAFETY_DISCLAIMER } from '../../design-system'

/** backend/app/services/twin.py MEDICATION_ACTIONS — transcribed, not
    re-derived, so this can never silently drift from what the backend
    actually validates. */
const ACTIONS = [
  ['started', 'Started'],
  ['continued', 'Continued'],
  ['dose_changed', 'Dose changed'],
  ['stopped', 'Stopped'],
] as const

const todayInput = () => new Date().toISOString().slice(0, 10)
const input = 'w-full rounded-[10px] border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-teal focus-visible:outline-none'

/**
 * Records a `medication_change` event — backend-validated
 * (twin_service.validate_medication_payload), already surfaced via
 * GET /api/twin/{id}/digital-twin's `medications.current`/`.history`,
 * previously unused by the frontend. A historical record, never a
 * prescription — matches the backend's own framing exactly.
 */
export function MedicationDrawer({
  open,
  onOpenChange,
  patientId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: number
  onSaved: (event: TimelineEvent) => Promise<void> | void
}) {
  const [name, setName] = useState('')
  const [action, setAction] = useState<(typeof ACTIONS)[number][0]>('started')
  const [dose, setDose] = useState('')
  const [date, setDate] = useState(todayInput())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      // Only backdate when the user actually changed the date — see
      // VitalsLabsDrawer.tsx for why defaulting to a fixed midnight
      // timestamp on "today" would invert same-day event ordering.
      const backdated = date !== todayInput()
      const event = await api.appendEvent(patientId, {
        event_type: 'medication_change',
        payload: { medication_name: name.trim(), action, ...(dose.trim() ? { dose: dose.trim() } : {}) },
        ...(backdated ? { recorded_at: new Date(date).toISOString() } : {}),
      })
      await onSaved(event)
      setName(''); setDose(''); setAction('started'); setDate(todayInput())
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title="Record medication change"
      description="A historical record of what was reported — not a prescription."
      footer={
        <div>
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy || !name.trim()}>
              <Pill size={14} /> {busy ? 'Recording…' : 'Record'}
            </Button>
          </div>
          <p className="mt-2.5 text-[0.64rem] leading-relaxed text-ink-3">{SAFETY_DISCLAIMER}</p>
        </div>
      }
    >
      {error && (
        <div role="alert" className="mb-5 rounded-[10px] border border-rose/40 bg-rose/10 px-4 py-3 text-sm text-ink">
          {error}
        </div>
      )}

      <label className="mb-5 block text-sm font-medium text-ink">
        Medication name
        <input autoFocus className={`mt-1.5 ${input}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Metformin" />
      </label>

      <div className="mb-5">
        <p className="mb-1.5 text-sm font-medium text-ink">Action</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Action">
          {ACTIONS.map(([v, l]) => (
            <ChipButton key={v} selected={action === v} tone="teal" onClick={() => setAction(v)}>{l}</ChipButton>
          ))}
        </div>
      </div>

      <label className="mb-5 block text-sm font-medium text-ink">
        Dose <span className="font-normal text-ink-3">(optional)</span>
        <input className={`mt-1.5 ${input}`} value={dose} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 500mg daily" />
      </label>

      <label className="block text-sm font-medium text-ink">
        Date
        <input type="date" max={todayInput()} className={`mt-1.5 ${input}`} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
    </Drawer>
  )
}
