import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { ClinicalAnalysis, DigitalTwin, LabTrend, Patient } from '../api/types'
import { ClinicalAnalysisPage } from './ClinicalAnalysisPage'

vi.mock('../api/client', () => ({
  api: {
    digitalTwin: vi.fn(),
    labTrend: vi.fn(),
    analyzeClinical: vi.fn(),
  },
}))

const PATIENT: Patient = {
  id: 4,
  pseudonym: 'Demo Patient B (moderate risk)',
  age: 52,
  sex: 'female',
  is_synthetic: true,
  screening_eligible: true,
  created_at: '2026-01-01T00:00:00Z',
}

vi.mock('../PatientContext', () => ({
  usePatients: () => ({
    patients: [PATIENT],
    selected: PATIENT,
    selectPatient: vi.fn(),
    refresh: vi.fn(),
    loading: false,
    error: null,
  }),
}))

const TWIN: DigitalTwin = {
  patient: { patient_id: 4, age: 52, sex: 'female' },
  clinical: { high_bp: 1, bmi: 28.8 },
  laboratory: { latest: {}, history: [] },
  medications: {
    current: [{ medication_name: 'Metformin', action: 'started', dose: '500mg daily', recorded_at: '2026-04-30T00:00:00Z' }],
    history: [],
  },
  lifestyle: { phys_activity: 1 },
  timeline: [],
}

const HBA1C: LabTrend = {
  test_name: 'HbA1c',
  latest: { test_name: 'HbA1c', value: 7.8, unit: '%', recorded_at: '2026-08-28T00:00:00Z' },
  history: [
    { test_name: 'HbA1c', value: 7.0, unit: '%', recorded_at: '2026-03-01T00:00:00Z' },
    { test_name: 'HbA1c', value: 7.8, unit: '%', recorded_at: '2026-08-28T00:00:00Z' },
  ],
  trend: 'increasing',
}

const ANALYSIS: ClinicalAnalysis = {
  patient_id: 4,
  question: "What is relevant to this patient's diabetes risk?",
  status: 'analyzed',
  scope: 'educational_screening_only',
  patient_summary: [
    { claim: 'Recorded high blood pressure: 1.', claim_type: 'patient_observation', evidence_ids: [] },
  ],
  model_analysis: [
    {
      claim: 'The production RandomForest screening model assigned a score of 0.59 (Moderate tier). This is a model-generated score, not a clinical probability.',
      claim_type: 'model_observation',
      evidence_ids: [],
    },
  ],
  evidence_findings: [
    {
      text: 'Risk factors for type 2 diabetes include being overweight and physically inactive.',
      document_id: 'cdc_diabetes_basics#risk-factors-for-type-2-diabetes',
      section: 'Risk factors for type 2 diabetes',
      title: 'Diabetes Basics',
      publisher: 'Centers for Disease Control and Prevention (CDC)',
      source_url: 'https://www.cdc.gov/diabetes/about/index.html',
      accessed: '2026-08-23',
      license: 'U.S. Government work — public domain',
      attribution: '',
      score: 0.66,
      source_type: 'local',
      doi: '',
    },
  ],
  simulation: null,
  integrated_analysis: [
    {
      claim: 'Based on the available patient data and model output, the retrieved literature below provides related context.',
      claim_type: 'inference',
      evidence_ids: ['E1'],
    },
  ],
  uncertainties: ['The production screening model has not been clinically validated.'],
  citations: ['[E1] Centers for Disease Control and Prevention (CDC), "Diabetes Basics" — Risk factors for type 2 diabetes (https://www.cdc.gov/diabetes/about/index.html)'],
  safety_flags: [],
  unavailable_reason: null,
  generated_by: 'rules',
  production_risk_tier: 'Moderate',
  safety: { status: 'APPROVED', reasons: [], disclaimer: 'Educational prototype disclaimer.', banner: null, policy_version: '1.1.0' },
  trace: ['OrchestratorAgent: routing mode=\'clinical\' for patient 4.', 'ClinicalAnalysisAgent: analyzed (rules).'],
}

describe('ClinicalAnalysisPage', () => {
  beforeEach(() => {
    vi.mocked(api.digitalTwin).mockResolvedValue(TWIN)
    vi.mocked(api.labTrend).mockResolvedValue(HBA1C)
    vi.mocked(api.analyzeClinical).mockResolvedValue(ANALYSIS)
  })

  it('loads the Digital Twin view for the selected patient on mount', async () => {
    render(<ClinicalAnalysisPage />)
    await waitFor(() => expect(api.digitalTwin).toHaveBeenCalledWith(4))
    expect(api.labTrend).toHaveBeenCalledWith(4, 'HbA1c')
    expect(await screen.findByText(/Metformin/)).toBeDefined()
    expect(screen.getByText(/Recorded patient history — not a treatment recommendation/)).toBeDefined()
  })

  it('disables Analyze until a question is entered', async () => {
    render(<ClinicalAnalysisPage />)
    const button = await screen.findByRole('button', { name: /^Analyze$/ })
    expect(button.hasAttribute('disabled')).toBe(true)

    const textarea = screen.getByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: "What about this patient's BMI?" } })
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('runs the full flow: question -> analyze -> loading -> result -> evidence display', async () => {
    render(<ClinicalAnalysisPage />)
    const textarea = await screen.findByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: "What is relevant to this patient's diabetes risk?" } })

    const button = screen.getByRole('button', { name: /^Analyze$/ })
    fireEvent.click(button)

    // Loading state
    expect(screen.getByText(/Analyzing…/)).toBeDefined()

    // Result
    await waitFor(() => expect(screen.getByText(/Safety review: approved/i)).toBeDefined())
    expect(api.analyzeClinical).toHaveBeenCalledWith(
      4,
      "What is relevant to this patient's diabetes risk?",
      expect.objectContaining({ includeEvidence: true, includePubmed: false }),
    )
    expect(screen.getByText(/Recorded high blood pressure: 1\./)).toBeDefined()
    expect(screen.getByText(/production RandomForest screening model assigned a score/)).toBeDefined()

    // Evidence display — numbered citation, collapsed by default
    expect(screen.getByText(/\[E1\] Diabetes Basics/)).toBeDefined()
    expect(screen.queryByText(/Document ID/)).toBeNull()

    fireEvent.click(screen.getByText(/\[E1\] Diabetes Basics/))
    expect(await screen.findByText(/Document ID/)).toBeDefined()
    expect(screen.getByText('cdc_diabetes_basics#risk-factors-for-type-2-diabetes')).toBeDefined()
  })

  it('never labels the candidate model as production', async () => {
    render(<ClinicalAnalysisPage />)
    const textarea = await screen.findByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: 'diabetes risk' } })
    fireEvent.click(screen.getByRole('button', { name: /^Analyze$/ }))
    await waitFor(() => expect(screen.getByText(/Safety review: approved/i)).toBeDefined())

    expect(screen.getByText('Production model — RandomForest')).toBeDefined()
    expect(screen.getByText('Candidate model — XGBoost')).toBeDefined()
    expect(screen.getByText('Not requested for this analysis.')).toBeDefined()
  })

  it('shows a network error via ErrorNote rather than a fake result', async () => {
    vi.mocked(api.analyzeClinical).mockRejectedValueOnce(new Error('Cannot reach the MedGenesis API'))
    render(<ClinicalAnalysisPage />)
    const textarea = await screen.findByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: 'diabetes risk' } })
    fireEvent.click(screen.getByRole('button', { name: /^Analyze$/ }))

    expect(await screen.findByText(/Cannot reach the MedGenesis API/)).toBeDefined()
    expect(screen.queryByText(/Safety review/)).toBeNull()
  })

  it('shows the simulation-unavailable message rather than fabricating a value', async () => {
    vi.mocked(api.analyzeClinical).mockResolvedValueOnce({
      ...ANALYSIS,
      simulation: {
        id: null,
        patient_id: 4,
        status: 'unavailable_for_profile',
        scope: 'educational_screening_only',
        label: 'simulated projection, not a clinical forecast',
        hypothesis: {},
        trajectory: [],
        assumptions: [],
        unavailable_reason: 'No change was specified.',
        base_timeline_event_id: null,
        summary_text: '',
        safety: ANALYSIS.safety,
        trace: [],
      },
    })
    render(<ClinicalAnalysisPage />)
    const textarea = await screen.findByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: 'what if bmi decreased' } })
    fireEvent.click(screen.getByLabelText(/What-if simulation/))
    fireEvent.click(screen.getByRole('button', { name: /^Analyze$/ }))

    expect(await screen.findByText(/Simulation unavailable for this profile\/request\. No change was specified\./)).toBeDefined()
  })

  it('renders a blocked analysis without leaking withheld content', async () => {
    vi.mocked(api.analyzeClinical).mockResolvedValueOnce({
      ...ANALYSIS,
      patient_summary: [],
      model_analysis: [],
      evidence_findings: [],
      citations: [],
      integrated_analysis: [{ claim: 'This response was withheld by the MedGenesis safety layer.', claim_type: 'uncertainty', evidence_ids: [] }],
      safety: { status: 'BLOCKED', reasons: ['[medication_advice] ...'], disclaimer: null, banner: null, policy_version: '1.1.0' },
    })
    render(<ClinicalAnalysisPage />)
    const textarea = await screen.findByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: 'diabetes risk' } })
    fireEvent.click(screen.getByRole('button', { name: /^Analyze$/ }))

    expect(await screen.findByText(/Blocked by the safety layer/i)).toBeDefined()
    expect(screen.getByText(/Analysis withheld/)).toBeDefined()
    expect(screen.queryByText(/Recorded high blood pressure/)).toBeNull()
  })
})
