import { NotebookPen } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api/client'
import type { TimelineEvent } from '../../api/types'
import { Button, Drawer, SAFETY_DISCLAIMER } from '../../design-system'

const todayInput = () => new Date().toISOString().slice(0, 10)

/**
 * Records a `note` event — free-text symptoms, medical history, or any
 * other context that doesn't fit a structured field. Deliberately NOT in
 * STATE_EVENT_TYPES (backend/app/services/twin.py), so nothing written
 * here can ever reach the screening model, by construction — the correct
 * home for information that's clinically real but not one of the 21
 * trained features.
 */
export function NoteDrawer({
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
  const [text, setText] = useState('')
  const [date, setDate] = useState(todayInput())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      // Only backdate when the user actually changed the date — see
      // VitalsLabsDrawer.tsx for why defaulting to a fixed midnight
      // timestamp on "today" would invert same-day event ordering.
      const backdated = date !== todayInput()
      const event = await api.appendEvent(patientId, {
        event_type: 'note',
        payload: { text: text.trim() },
        ...(backdated ? { recorded_at: new Date(date).toISOString() } : {}),
      })
      await onSaved(event)
      setText(''); setDate(todayInput())
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
      title="Add a note"
      description="Symptoms, medical history, or anything else worth recording — never read by the screening model."
      footer={
        <div>
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy || !text.trim()}>
              <NotebookPen size={14} /> {busy ? 'Saving…' : 'Add note'}
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
        Note
        <textarea
          autoFocus
          rows={6}
          className="mt-1.5 w-full resize-none rounded-[10px] border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-teal focus-visible:outline-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Patient reports mild dizziness on standing, no falls."
        />
      </label>

      <label className="block text-sm font-medium text-ink">
        Date
        <input
          type="date"
          max={todayInput()}
          className="mt-1.5 w-full rounded-[10px] border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-teal focus-visible:outline-none"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
    </Drawer>
  )
}
