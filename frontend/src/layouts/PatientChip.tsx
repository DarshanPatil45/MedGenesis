import { Check, ChevronDown, CircleAlert, ShieldCheck, UserRound } from 'lucide-react'
import { useState } from 'react'
import { PopoverPanel, PopoverRoot, PopoverTrigger } from '../design-system'
import { usePatients } from '../PatientContext'

/**
 * The currently selected synthetic patient. Click to switch.
 *
 * Every field shown comes from the real `PatientOut` record. The API has
 * no "history completeness" field, so `screening_eligible` is the only
 * completeness-adjacent status displayed.
 */
export function PatientChip() {
  const { patients, selected, selectPatient, loading } = usePatients()
  const [open, setOpen] = useState(false)

  if (loading && !selected) {
    return <span className="skeleton h-8 w-40 rounded-full" aria-label="Loading patients" />
  }

  if (!patients.length) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-border-strong px-3 py-1.5 text-xs text-ink-3">
        <UserRound size={13} />
        <span className="hidden sm:inline">No patients yet</span>
      </span>
    )
  }

  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Selected patient: ${selected?.pseudonym ?? 'none'}. Click to switch.`}
          className="inline-flex min-w-0 max-w-[9rem] items-center gap-2 rounded-full border border-border-strong bg-subtle py-1.5 pr-2 pl-3 text-xs transition-colors hover:border-ink-3 sm:max-w-[13rem] lg:max-w-xs"
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${selected?.screening_eligible ? 'bg-teal' : 'bg-amber'}`}
          />
          <span className="hidden shrink-0 font-mono text-[0.66rem] font-semibold text-teal sm:inline">
            #{selected?.id}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-ink">{selected?.pseudonym}</span>
          <ChevronDown size={13} className="shrink-0 text-ink-3" aria-hidden="true" />
        </button>
      </PopoverTrigger>

      <PopoverPanel className="w-[min(92vw,20rem)] p-0" align="end">
        <p className="border-b border-border-strong px-3 py-2.5 text-[0.6rem] font-bold tracking-[0.16em] text-ink-3 uppercase">
          Switch patient · {patients.length} synthetic
        </p>
        <div className="max-h-80 overflow-y-auto p-2">
          {patients.map((p) => {
            const active = p.id === selected?.id
            return (
              <button
                key={p.id}
                onClick={() => {
                  selectPatient(p.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors ${
                  active ? 'bg-teal/10' : 'hover:bg-subtle'
                }`}
              >
                <span className="w-8 shrink-0 font-mono text-[0.68rem] text-teal">#{p.id}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{p.pseudonym}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[0.68rem] text-ink-3">
                    {p.age} · {p.sex}
                    {p.screening_eligible ? (
                      <ShieldCheck size={10} className="text-teal" />
                    ) : (
                      <CircleAlert size={10} className="text-amber" />
                    )}
                  </span>
                </span>
                {active && <Check size={14} className="shrink-0 text-teal" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      </PopoverPanel>
    </PopoverRoot>
  )
}
