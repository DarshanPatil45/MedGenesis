import { Check, CircleAlert, Loader2, ShieldCheck, Sparkles, UserPlus, Users } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { DemoProfile, Patient, Screening } from '../../api/types'
import {
  Button,
  Card,
  CardLabel,
  Chip,
  CountUp,
  EmptyState,
  ErrorState,
  HScrollArea,
  RatioBar,
  SectionIndex,
  Skeleton,
  StageHeader,
  Stat,
  staggerChild,
  staggerParent,
} from '../../design-system'
import { ClinicalImage } from '../../design-system/visuals/ClinicalImage'
import { MEDIA } from '../../design-system/visuals/media'
import { TwinOrb } from '../../design-system/visuals/TwinOrb'
import { PageContainer } from '../../layouts/AppShell'
import { usePatients } from '../../PatientContext'
import { SystemStrip } from '../system/SystemStrip'
import { IntakeResultPanel } from './IntakeResultPanel'
import { IntakeWizard } from './IntakeWizard'

export function IntakePage() {
  const { patients, selected, selectPatient, refresh, loading, error: listError } = usePatients()
  const [profiles, setProfiles] = useState<Record<string, DemoProfile> | null>(null)
  const [profilesError, setProfilesError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [justCreated, setJustCreated] = useState<{ patient: Patient; screening: Screening | null } | null>(null)
  const reduced = useReducedMotion()

  const loadProfiles = () => {
    setProfilesError(null)
    api
      .demoProfiles()
      .then(setProfiles)
      .catch((e) => {
        setProfiles({})
        setProfilesError(e instanceof Error ? e.message : String(e))
      })
  }

  useEffect(loadProfiles, [])

  const loadDemo = async (key: string) => {
    setBusyKey(key)
    setError(null)
    try {
      const patient = await api.createDemoPatient(key)
      await refresh()
      selectPatient(patient.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyKey(null)
    }
  }

  const eligibleCount = patients.filter((p) => p.screening_eligible).length

  return (
    <>
      {/* ── Stage ─────────────────────────────────────────────────── */}
      <section className="relative border-b border-border-strong">
        <PageContainer className="py-14 lg:py-20">
          <StageHeader
            eyebrow="Patients"
            eyebrowIcon={UserPlus}
            title={
              <>
                Begin the Digital Twin
                <br />
                <span className="text-gradient">journey.</span>
              </>
            }
            subtitle="Select or create a synthetic patient profile. Everything downstream — the longitudinal twin, the risk models, retrieved evidence, AI synthesis and the safety gate — is built from this record."
            aside={
              <div className="relative mx-auto flex h-72 w-72 items-center justify-center sm:h-[22rem] sm:w-[22rem]">
                <div
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle at 42% 34%, rgb(21 183 158 / 0.20), rgb(46 144 250 / 0.10) 45%, transparent 70%)',
                  }}
                />
                <div
                  aria-hidden="true"
                  className="ambient-drift absolute inset-6 rounded-full border border-teal/15"
                />
                <TwinOrb patient={selected} className="relative h-full w-full" />
              </div>
            }
            metrics={
              <>
                <Stat
                  label="Synthetic cohort"
                  value={loading ? '—' : <CountUp value={patients.length} />}
                  hint="patients on file"
                />
                <Stat
                  label="Screening eligible"
                  value={loading ? '—' : <CountUp value={eligibleCount} />}
                  hint={patients.length ? `${Math.round((eligibleCount / patients.length) * 100)}% of cohort` : undefined}
                />
                <Stat
                  label="Seeded scenarios"
                  value={profiles ? <CountUp value={Object.keys(profiles).length} /> : '—'}
                  hint="demo profiles"
                />
                <div className="min-w-[10rem] flex-1">
                  <RatioBar value={eligibleCount} total={patients.length} label="Eligible / total" />
                </div>
              </>
            }
            actions={
              <>
                <Button variant="primary" size="lg" onClick={() => setWizardOpen(true)}>
                  <UserPlus size={16} />
                  Create a synthetic profile
                </Button>
                {selected && (
                  <Chip tone="teal" dot>
                    Active: {selected.pseudonym}
                  </Chip>
                )}
              </>
            }
          />
        </PageContainer>
      </section>

      {/* ── Two paths ─────────────────────────────────────────────── */}
      <PageContainer className="py-12 lg:py-16">
        {justCreated && (
          <IntakeResultPanel
            patient={justCreated.patient}
            screening={justCreated.screening}
            onDismiss={() => setJustCreated(null)}
          />
        )}

        <ErrorState error={error} onRetry={() => setError(null)} />
        <ErrorState error={listError} onRetry={() => void refresh()} />

        <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
          {/* Path 1 — seed a scenario (7 cols) */}
          <div className="min-w-0 lg:col-span-7">
            <SectionIndex n={1}>Load a seeded clinical scenario</SectionIndex>
            <p className="mb-5 max-w-xl text-sm leading-relaxed text-ink-2">
              Each profile ships with six months of synthetic history. Profile C deliberately has an incomplete
              record — the screening agent declines to score it rather than guessing at missing measurements.
            </p>

            <ErrorState error={profilesError} onRetry={loadProfiles} />

            {profiles === null ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-32" />
                ))}
              </div>
            ) : Object.keys(profiles).length === 0 && !profilesError ? (
              <EmptyState
                icon={Users}
                title="No demo profiles available"
                reason="The backend returned no seeded profiles. Create a synthetic profile instead."
                action={<Button variant="primary" onClick={() => setWizardOpen(true)}>Create a profile</Button>}
              />
            ) : (
              <motion.div
                className="grid gap-3 sm:grid-cols-3"
                variants={staggerParent}
                initial={reduced ? false : 'hidden'}
                animate="visible"
              >
                {Object.entries(profiles).map(([key, profile]) => {
                  const active = selected?.pseudonym === profile.pseudonym
                  const busy = busyKey === key
                  return (
                    <motion.button
                      key={key}
                      variants={staggerChild}
                      type="button"
                      onClick={() => loadDemo(key)}
                      disabled={!!busyKey}
                      aria-pressed={active}
                      className={`group relative overflow-hidden rounded-[14px] border p-4 text-left transition-all duration-200 disabled:cursor-wait ${
                        active
                          ? 'border-teal/50 bg-teal/8'
                          : 'border-border-strong bg-surface hover:-translate-y-0.5 hover:border-ink-3'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-[0.6rem] tracking-[0.14em] text-ink-3 uppercase">Profile</span>
                        {busy ? (
                          <Loader2 size={13} className="animate-spin text-teal" />
                        ) : active ? (
                          <Check size={13} className="text-teal" />
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm leading-snug font-semibold text-ink">{profile.pseudonym}</p>
                      <p className="mt-1 text-xs text-ink-3">
                        {profile.age} · {profile.sex}
                      </p>
                      <span
                        className={`mt-3 inline-flex items-center gap-1.5 text-[0.68rem] font-semibold ${
                          profile.screening_eligible ? 'text-teal' : 'text-amber'
                        }`}
                      >
                        {profile.screening_eligible ? <ShieldCheck size={11} /> : <CircleAlert size={11} />}
                        {profile.screening_eligible ? 'Screening eligible' : 'Incomplete history'}
                      </span>
                    </motion.button>
                  )
                })}
              </motion.div>
            )}

            {/* Existing patients — horizontally scrolling rail */}
            <div className="mt-10">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                <CardLabel className="mb-0">
                  Existing patients · {patients.length}
                </CardLabel>
                {patients.length > 0 && (
                  <span className="text-[0.68rem] text-ink-3">{eligibleCount} screening-eligible</span>
                )}
              </div>

              {loading && patients.length === 0 ? (
                <div className="flex gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-24 w-52 shrink-0" />
                  ))}
                </div>
              ) : patients.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No patients yet"
                  reason="Load a seeded scenario above, or create a synthetic profile to start the journey."
                />
              ) : (
                <HScrollArea>
                  <ul className="flex gap-3 pb-3">
                    {patients.map((p) => {
                      const active = selected?.id === p.id
                      return (
                        <li key={p.id} className="shrink-0">
                          <button
                            onClick={() => selectPatient(p.id)}
                            aria-pressed={active}
                            className={`w-52 rounded-[14px] border p-3.5 text-left transition-colors ${
                              active
                                ? 'border-teal/50 bg-teal/8'
                                : 'border-border-strong bg-surface hover:border-ink-3'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-[0.66rem] font-semibold text-teal">#{p.id}</span>
                              {active && <Check size={12} className="text-teal" />}
                            </div>
                            <p className="mt-1.5 truncate text-sm font-medium text-ink">{p.pseudonym}</p>
                            <p className="mt-0.5 text-[0.68rem] text-ink-3">
                              {p.age} · {p.sex}
                            </p>
                            <span
                              className={`mt-2 inline-flex items-center gap-1 text-[0.64rem] ${
                                p.screening_eligible ? 'text-teal' : 'text-amber'
                              }`}
                            >
                              {p.screening_eligible ? <ShieldCheck size={10} /> : <CircleAlert size={10} />}
                              {p.screening_eligible ? 'eligible' : 'incomplete'}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </HScrollArea>
              )}
            </div>
          </div>

          {/* Path 2 — create (5 cols) */}
          <div className="min-w-0 lg:col-span-5">
            <SectionIndex n={2}>Create a synthetic profile</SectionIndex>
            <Card layer="shell" pad="lg" className="relative overflow-hidden">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_70%_at_80%_0%,rgb(135 91 247 / 0.10),transparent_65%)]"
              />
              <div className="relative">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border-strong bg-subtle text-violet">
                  <Sparkles size={19} />
                </span>
                <h2 className="mt-4 text-lg font-semibold text-ink">Build a twin from scratch</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">
                  A seven-section clinical intake covering the complete BRFSS baseline — every one of the 21
                  features the screening model was trained on, not a handful of proxies.
                </p>

                <ol className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    'Patient identity',
                    'Cardiometabolic history',
                    'Functional health',
                    'Lifestyle',
                    'Healthcare access',
                    'Sociodemographic context',
                    'Review & create',
                  ].map((label, i) => (
                    <li key={label} className="flex items-center gap-2.5 text-sm">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface font-mono text-[0.6rem] text-ink-3">
                        {i + 1}
                      </span>
                      <span className="text-ink-2">{label}</span>
                    </li>
                  ))}
                </ol>

                <Button variant="primary" className="mt-7 w-full" onClick={() => setWizardOpen(true)}>
                  Start the intake workstation
                </Button>
                <p className="mt-3 text-[0.68rem] leading-relaxed text-ink-3">
                  All 21 trained features are collected up front, so the resulting profile is screening-eligible
                  the moment it's created — screening then runs automatically.
                </p>
              </div>
            </Card>
          </div>
        </div>
      </PageContainer>

      <PageContainer className="pb-12">
        <ClinicalImage
          src={MEDIA['intake-context'].src}
          alt={MEDIA['intake-context'].alt}
          aspect="21 / 6"
          overlay={
            <p className="max-w-xl text-sm leading-relaxed text-white/90">
              <span className="font-semibold text-white">Self-monitoring is the data source this system reasons over.</span>{' '}
              MedGenesis models the record, not the person — every profile here is synthetic.
            </p>
          }
        />
      </PageContainer>

      <PageContainer className="pb-16">
        {/* Backend implementation detail (store engine, model artifact,
            embedding/LLM backend) — real and honest, but it belongs behind
            an opt-in disclosure, not on the first screen a clinical user
            sees. Everyone who wants it can still find it here. */}
        <details className="data-surface rounded-[14px]">
          <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-ink">Advanced · Service status</summary>
          <div className="border-t border-border-strong px-5 py-4">
            <SystemStrip />
            <p className="mt-3 text-[0.68rem] text-ink-3">
              Reported live by <code className="font-mono">GET /api/health</code>. The language row shows the path
              actually in use — the rule-based responder is used whenever no model server is reachable.
            </p>
          </div>
        </details>
      </PageContainer>

      <IntakeWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={async (patient) => {
          await refresh()
          selectPatient(patient.id)
          // "Immediately show the resulting Digital Twin and screening
          // state" — the twin already exists (the patient row plus the
          // one measurement event the wizard just wrote); screening is
          // the one piece that needs an explicit run, so trigger it now
          // rather than making the user find the button on another page.
          // A failed run still surfaces honestly — never a fake score.
          let screening: Screening | null = null
          try {
            screening = await api.runScreening(patient.id)
          } catch {
            screening = null
          }
          setJustCreated({ patient, screening })
        }}
      />
    </>
  )
}
