import { ArrowRight, CircleAlert, Droplet, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Patient, Screening } from '../../api/types'
import { Card, Chip, CountUp, riskColor } from '../../design-system'
import { DiabetesDrawer } from '../twin/DiabetesDrawer'

/**
 * Shown once, immediately after a patient is created — the real Digital
 * Twin identity plus the real screening outcome the wizard just triggered.
 * Every figure here is read straight off the two API responses that
 * produced it (`POST /api/patients`, `POST /api/screening/run`); there is
 * no local computation and nothing is shown before both calls resolve.
 */
export function IntakeResultPanel({
  patient,
  screening,
  onDismiss,
}: {
  patient: Patient
  screening: Screening | null
  onDismiss: () => void
}) {
  const scored = screening?.status === 'scored'
  const tier = screening?.risk_tier?.toLowerCase() ?? ''
  const [diabetesOpen, setDiabetesOpen] = useState(false)
  const [diabetesAdded, setDiabetesAdded] = useState(false)

  return (
    <Card layer="raised" pad="lg" className="relative mb-10 overflow-hidden">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute top-4 right-4 flex h-7 w-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-subtle hover:text-ink"
      >
        <X size={14} />
      </button>

      <div className="flex items-center gap-2 text-teal">
        <ShieldCheck size={16} />
        <p className="text-[0.66rem] font-bold tracking-[0.16em] uppercase">Digital twin created</p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-8 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-ink">{patient.pseudonym}</p>
          <p className="mt-0.5 text-sm text-ink-3">
            #{patient.id} · {patient.age} · {patient.sex}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              to="/twin"
              className="inline-flex items-center gap-1.5 rounded-full border border-teal/40 bg-teal/10 px-3.5 py-1.5 text-sm font-medium text-teal transition-colors hover:bg-teal/16"
            >
              View Digital Twin <ArrowRight size={13} />
            </Link>
            {scored && (
              <Link
                to="/assessment"
                className="inline-flex items-center gap-1.5 rounded-full border border-border-strong px-3.5 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
              >
                View full assessment
              </Link>
            )}
            <button
              type="button"
              onClick={() => setDiabetesOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-strong px-3.5 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
            >
              <Droplet size={13} /> {diabetesAdded ? 'Add more diabetes & blood sugar info' : 'Add diabetes & blood sugar info'}
            </button>
          </div>
          {diabetesAdded && (
            <p className="mt-2.5 text-xs text-teal">Recorded — visible on this patient's Digital Twin.</p>
          )}
        </div>

        {/* Real screening outcome, or an honest refusal — never a placeholder. */}
        <div className="min-w-[15rem] rounded-[14px] border border-border-strong bg-surface px-5 py-4">
          <p className="text-[0.62rem] font-bold tracking-[0.14em] text-ink-3 uppercase">Screening baseline</p>
          {scored && screening ? (
            <>
              <p className="mt-1.5 font-mono text-3xl font-bold tabular-nums" style={{ color: riskColor[tier] }}>
                <CountUp value={(screening.risk_probability ?? 0) * 100} decimals={1} suffix="%" />
              </p>
              <p className="mt-1 text-sm text-ink-2">{screening.risk_tier} tier</p>
              <p className="mt-1 text-[0.66rem] text-ink-3">{screening.model_version}</p>
            </>
          ) : (
            <div className="mt-2 flex items-start gap-2">
              <CircleAlert size={15} className="mt-0.5 shrink-0 text-amber" />
              <p className="text-xs leading-relaxed text-ink-2">
                {screening?.unavailable_reason ?? 'Screening could not be run for this profile.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {scored && (
        <Chip tone="outline" className="mt-5">
          Screening ran automatically from this intake — re-run it any time from Assessment
        </Chip>
      )}

      <DiabetesDrawer
        open={diabetesOpen}
        onOpenChange={setDiabetesOpen}
        patientId={patient.id}
        onSaved={() => setDiabetesAdded(true)}
      />
    </Card>
  )
}
