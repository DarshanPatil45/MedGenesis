import {
  ArrowRight,
  Banknote,
  CircleAlert,
  ClipboardPlus,
  Footprints,
  HeartPulse,
  ShieldPlus,
  Sparkles,
  UserCheck,
  UserRoundPlus,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DemoProfile } from '../api/types'
import { usePatients } from '../PatientContext'
import { ErrorNote } from '../components/common'
import { ScopeDisclaimer } from '../components/SafetyBanner'

const STEPS = ['Patient', 'Demographics', 'Health signals', 'Digital Twin']

const CONDITION_FIELDS = [
  ['high_bp', 'High blood pressure'],
  ['high_chol', 'High cholesterol'],
  ['chol_check', 'Cholesterol checked in the past 5 years'],
  ['stroke', 'Ever had a stroke'],
  ['heart_disease_or_attack', 'Coronary heart disease or heart attack'],
  ['diff_walk', 'Serious difficulty walking or climbing stairs'],
] as const

const LIFESTYLE_FIELDS = [
  ['smoker', 'Smoked at least 100 cigarettes in your life'],
  ['phys_activity', 'Physical activity in the past 30 days (not counting job)'],
  ['fruits', 'Eats fruit one or more times per day'],
  ['veggies', 'Eats vegetables one or more times per day'],
  ['hvy_alcohol_consump', 'Heavy alcohol consumption'],
] as const

const HEALTHCARE_FIELDS = [
  ['any_healthcare', 'Has any kind of health care coverage'],
  ['no_doc_bc_cost', 'Needed a doctor in the past 12 months but could not afford it'],
] as const

const CHECKBOX_FIELDS = [...CONDITION_FIELDS, ...LIFESTYLE_FIELDS, ...HEALTHCARE_FIELDS]

const GEN_HLTH_OPTIONS = [
  ['1', 'Excellent'],
  ['2', 'Very good'],
  ['3', 'Good'],
  ['4', 'Fair'],
  ['5', 'Poor'],
] as const

const EDUCATION_OPTIONS = [
  ['1', 'Never attended school / kindergarten only'],
  ['2', 'Elementary (grades 1–8)'],
  ['3', 'Some high school (grades 9–11)'],
  ['4', 'High school graduate or GED'],
  ['5', 'Some college or technical school'],
  ['6', 'College graduate'],
] as const

const INCOME_OPTIONS = [
  ['1', 'Less than $10,000'],
  ['2', '$10,000–$14,999'],
  ['3', '$15,000–$19,999'],
  ['4', '$20,000–$24,999'],
  ['5', '$25,000–$34,999'],
  ['6', '$35,000–$49,999'],
  ['7', '$50,000–$74,999'],
  ['8', '$75,000 or more'],
] as const

const EMPTY_FORM = {
  pseudonym: '',
  age: '45',
  sex: 'female',
  bmi: '',
  gen_hlth: '2',
  ment_hlth: '0',
  phys_hlth: '0',
  education: '5',
  income: '6',
  high_bp: false,
  high_chol: false,
  chol_check: true,
  stroke: false,
  heart_disease_or_attack: false,
  diff_walk: false,
  smoker: false,
  phys_activity: true,
  fruits: true,
  veggies: true,
  hvy_alcohol_consump: false,
  any_healthcare: true,
  no_doc_bc_cost: false,
}

type FormState = typeof EMPTY_FORM

export function IntakePage() {
  const { patients, selected, selectPatient, refresh } = usePatients()
  const [profiles, setProfiles] = useState<Record<string, DemoProfile>>({})
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [patientFilter, setPatientFilter] = useState('')

  useEffect(() => {
    api.demoProfiles().then(setProfiles).catch(() => setProfiles({}))
  }, [])

  const loadDemo = async (key: string) => {
    setBusy(true)
    setError(null)
    try {
      const patient = await api.createDemoPatient(key)
      await refresh()
      selectPatient(patient.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const measurements: Record<string, number> = {}
      for (const [key] of CHECKBOX_FIELDS) {
        measurements[key] = form[key] ? 1 : 0
      }
      if (form.bmi !== '') measurements.bmi = Number(form.bmi)
      measurements.gen_hlth = Number(form.gen_hlth)
      measurements.ment_hlth = Number(form.ment_hlth)
      measurements.phys_hlth = Number(form.phys_hlth)
      measurements.education = Number(form.education)
      measurements.income = Number(form.income)

      const patient = await api.createPatient({
        pseudonym: form.pseudonym || 'Unnamed patient',
        age: Number(form.age),
        sex: form.sex,
        baseline_measurements: measurements,
      })
      await refresh()
      selectPatient(patient.id)
      setForm(EMPTY_FORM)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const needle = patientFilter.trim().toLowerCase()
  const filteredPatients = needle
    ? patients.filter((p) => String(p.id).includes(needle) || p.pseudonym.toLowerCase().includes(needle))
    : patients

  const checkbox = (key: (typeof CHECKBOX_FIELDS)[number][0], label: string) => (
    <label key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
      <input
        type="checkbox"
        checked={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
      />
      {label}
    </label>
  )

  return (
    <>
      <div className="section-block">
        <span className="eyebrow">
          <Sparkles /> Digital Twin setup
        </span>
        <h1 className="section-title">Create Patient Digital Twin</h1>
        <p className="section-lead">
          Load a synthetic patient or create one. All data in this system is synthetic — never
          real patient data. The intake fields below mirror the CDC BRFSS survey questions the
          screening model was trained on.
        </p>
        <div className="step-flow" aria-hidden="true">
          {STEPS.map((step, i) => (
            <span key={step} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {i > 0 && <ArrowRight size={11} className="step-flow-arrow" />}
              <span className="step-flow-item">
                <span className="step-flow-num">{i + 1}</span>
                {step}
              </span>
            </span>
          ))}
        </div>
      </div>
      <ScopeDisclaimer />
      <ErrorNote error={error} />

      <div className="section-block">
        <span className="micro-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <UserRoundPlus size={13} /> Load a synthetic demo patient
        </span>
        <p className="muted" style={{ marginTop: 0 }}>
          Profile C deliberately has an incomplete recorded history. That is a designed
          behaviour, not a bug — the screening agent refuses to guess at missing measurements
          rather than produce a confident-looking, meaningless score.
        </p>
        <div className="grid-2">
          {Object.entries(profiles).map(([key, profile]) => (
            <button key={key} type="button" className="tile" onClick={() => loadDemo(key)} disabled={busy}>
              <span className="tile-icon" aria-hidden="true">
                {profile.screening_eligible ? <UserCheck size={16} /> : <CircleAlert size={16} />}
              </span>
              <span className="tile-body">
                <span className="tile-title">{profile.pseudonym}</span>
                <span className="tile-desc">
                  {profile.screening_eligible ? 'Screening-eligible' : 'Not screenable — incomplete history'}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="section-block">
        <span className="micro-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ClipboardPlus size={13} /> Create a patient manually
        </span>
        <form onSubmit={submit}>
          <div className="grid-2">
            <label>
              Pseudonym
              <input
                value={form.pseudonym}
                onChange={(e) => setForm({ ...form, pseudonym: e.target.value })}
                placeholder="e.g. Participant 004"
              />
            </label>
            <label>
              Age
              <input
                type="number"
                min={18}
                max={120}
                value={form.age}
                onChange={(e) => setForm({ ...form, age: e.target.value })}
              />
            </label>
            <label>
              Sex
              <select value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}>
                <option value="female">female</option>
                <option value="male">male</option>
                <option value="other">other</option>
                <option value="unspecified">unspecified</option>
              </select>
            </label>
            <label>
              BMI
              <input
                type="number"
                step="any"
                value={form.bmi}
                onChange={(e) => setForm({ ...form, bmi: e.target.value })}
              />
            </label>
          </div>

          <h3 className="row" style={{ marginTop: '1.3rem', gap: '0.4rem' }}>
            <HeartPulse size={15} style={{ color: 'var(--brand)' }} /> General health
          </h3>
          <div className="grid-2">
            <label>
              Self-rated general health
              <select
                value={form.gen_hlth}
                onChange={(e) => setForm({ ...form, gen_hlth: e.target.value })}
              >
                {GEN_HLTH_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Days of poor mental health (last 30)
              <input
                type="number"
                min={0}
                max={30}
                value={form.ment_hlth}
                onChange={(e) => setForm({ ...form, ment_hlth: e.target.value })}
              />
            </label>
            <label>
              Days of poor physical health (last 30)
              <input
                type="number"
                min={0}
                max={30}
                value={form.phys_hlth}
                onChange={(e) => setForm({ ...form, phys_hlth: e.target.value })}
              />
            </label>
          </div>

          <h3 className="row" style={{ marginTop: '1.3rem', gap: '0.4rem' }}>
            <ClipboardPlus size={15} style={{ color: 'var(--brand)' }} /> Conditions
          </h3>
          <div className="grid-2">{CONDITION_FIELDS.map(([k, l]) => checkbox(k, l))}</div>

          <h3 className="row" style={{ marginTop: '1.3rem', gap: '0.4rem' }}>
            <Footprints size={15} style={{ color: 'var(--brand)' }} /> Lifestyle
          </h3>
          <div className="grid-2">{LIFESTYLE_FIELDS.map(([k, l]) => checkbox(k, l))}</div>

          <h3 className="row" style={{ marginTop: '1.3rem', gap: '0.4rem' }}>
            <ShieldPlus size={15} style={{ color: 'var(--brand)' }} /> Healthcare access
          </h3>
          <div className="grid-2">{HEALTHCARE_FIELDS.map(([k, l]) => checkbox(k, l))}</div>

          <h3 className="row" style={{ marginTop: '1.3rem', gap: '0.4rem' }}>
            <Banknote size={15} style={{ color: 'var(--brand)' }} /> Socioeconomic
          </h3>
          <div className="grid-2">
            <label>
              Education level
              <select
                value={form.education}
                onChange={(e) => setForm({ ...form, education: e.target.value })}
              >
                {EDUCATION_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Household income
              <select value={form.income} onChange={(e) => setForm({ ...form, income: e.target.value })}>
                {INCOME_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ marginTop: '1rem' }}>
            <button type="submit" disabled={busy}>
              Create patient
            </button>
          </div>
        </form>
      </div>

      <div className="section-block">
        <span className="micro-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Users size={13} /> Patients ({patients.length})
        </span>
        {patients.length > 5 && (
          <div className="filter-row">
            <label htmlFor="patient-filter" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
              Filter
              <input
                id="patient-filter"
                type="search"
                placeholder="Search by ID or pseudonym…"
                value={patientFilter}
                onChange={(e) => setPatientFilter(e.target.value)}
              />
            </label>
            {patientFilter && (
              <span className="muted">
                {filteredPatients.length} of {patients.length} shown
              </span>
            )}
          </div>
        )}
        {filteredPatients.length === 0 ? (
          <p className="muted">No patients match "{patientFilter}".</p>
        ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Pseudonym</th>
                <th>Age</th>
                <th>Sex</th>
                <th>Screening eligible</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredPatients.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.pseudonym}</td>
                  <td>{p.age}</td>
                  <td>{p.sex}</td>
                  <td>
                    <span className={`badge ${p.screening_eligible ? 'low' : 'neutral'}`}>
                      {p.screening_eligible ? 'yes' : 'no'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() => selectPatient(p.id)}
                      disabled={selected?.id === p.id}
                    >
                      {selected?.id === p.id ? 'Active' : 'Select'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </>
  )
}
