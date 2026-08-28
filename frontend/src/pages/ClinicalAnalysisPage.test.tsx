import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { ClinicalAnalysis, DigitalTwin, LabTrend, ModelComparison, Patient } from '../api/types'
import { ClinicalAnalysisPage } from './ClinicalAnalysisPage'

vi.mock('../api/client', () => ({
  api: {
    digitalTwin: vi.fn(),
    labTrend: vi.fn(),
    analyzeClinical: vi.fn(),
    mlComparison: vi.fn(),
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

const PUBMED_SOURCE = {
  text: 'Findings from a randomized trial on physical activity and diabetes risk.',
  document_id: 'pubmed#99999999',
  section: 'Abstract',
  title: 'A PubMed study on diabetes risk',
  publisher: 'Diabetes Care',
  source_url: 'https://pubmed.ncbi.nlm.nih.gov/99999999/',
  accessed: '2026-08-27',
  license: '',
  attribution: '',
  score: 0.9,
  source_type: 'pubmed',
  doi: '10.1000/example.doi',
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
    vi.clearAllMocks()
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

  it('shows the HbA1c trend and history from the backend, never a computed threshold', async () => {
    render(<ClinicalAnalysisPage />)
    expect(await screen.findByText(/Trend across available measurements:/)).toBeDefined()
    expect(screen.getByText('increasing')).toBeDefined()
    expect(screen.getByText(/Trend classification is not a diagnostic threshold/)).toBeDefined()
    expect(screen.getByText('7.8%')).toBeDefined()
  })

  it('disables Analyze until a question is entered', async () => {
    render(<ClinicalAnalysisPage />)
    const button = await screen.findByRole('button', { name: /^Analyze Patient$/ })
    expect(button.hasAttribute('disabled')).toBe(true)

    const textarea = screen.getByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: "What about this patient's BMI?" } })
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('runs the full flow: question -> analyze -> loading -> result -> evidence display', async () => {
    render(<ClinicalAnalysisPage />)
    const textarea = await screen.findByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: "What is relevant to this patient's diabetes risk?" } })

    const button = screen.getByRole('button', { name: /^Analyze Patient$/ })
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

  it('groups evidence into Local and PubMed sections while preserving original [E#] numbering', async () => {
    vi.mocked(api.analyzeClinical).mockResolvedValueOnce({
      ...ANALYSIS,
      evidence_findings: [ANALYSIS.evidence_findings[0], PUBMED_SOURCE],
    })
    render(<ClinicalAnalysisPage />)
    const textarea = await screen.findByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: 'diabetes risk and recent literature' } })
    fireEvent.click(screen.getByLabelText(/PubMed literature/))
    fireEvent.click(screen.getByRole('button', { name: /^Analyze Patient$/ }))

    await waitFor(() => expect(screen.getByText(/Safety review: approved/i)).toBeDefined())
    expect(api.analyzeClinical).toHaveBeenCalledWith(4, expect.any(String), expect.objectContaining({ includePubmed: true }))
    expect(screen.getByText('Local evidence')).toBeDefined()
    expect(screen.getByText('PubMed evidence')).toBeDefined()
    expect(screen.getByText(/\[E1\] Diabetes Basics/)).toBeDefined()
    expect(screen.getByText(/\[E2\] A PubMed study on diabetes risk/)).toBeDefined()
  })

  it('shows an honest empty state when PubMed was requested but nothing came back', async () => {
    render(<ClinicalAnalysisPage />)
    const textarea = await screen.findByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: 'diabetes risk' } })
    fireEvent.click(screen.getByLabelText(/PubMed literature/))
    fireEvent.click(screen.getByRole('button', { name: /^Analyze Patient$/ }))

    expect(
      await screen.findByText(/Either no relevant PubMed result was available, or PubMed was unavailable/),
    ).toBeDefined()
  })

  it('never labels the candidate model as production', async () => {
    render(<ClinicalAnalysisPage />)
    const textarea = await screen.findByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: 'diabetes risk' } })
    fireEvent.click(screen.getByRole('button', { name: /^Analyze Patient$/ }))
    await waitFor(() => expect(screen.getByText(/Safety review: approved/i)).toBeDefined())

    expect(screen.getByText('Production model — RandomForest')).toBeDefined()
    expect(screen.getByText('Candidate model — XGBoost')).toBeDefined()
    expect(screen.getByText('Not requested for this analysis.')).toBeDefined()
  })

  it('shows the candidate model score and a real, backend-supplied metrics table when comparison is requested', async () => {
    const COMPARISON: ModelComparison = {
      random_forest: {
        model_version: 'rf-v1',
        algorithm: 'RandomForest',
        test_metrics: {},
        confusion_matrix: {},
        training_time_seconds: 1,
        inference_time_seconds_test_set: 0.1,
        inference_time_seconds_per_1000_rows: 0.01,
        model_size_bytes: 1000,
        feature_importances: {},
      },
      xgboost: {
        model_version: 'xgb-v1',
        algorithm: 'XGBoost',
        test_metrics: {},
        confusion_matrix: {},
        training_time_seconds: 1,
        inference_time_seconds_test_set: 0.1,
        inference_time_seconds_per_1000_rows: 0.01,
        model_size_bytes: 1000,
        feature_importances: {},
      },
      metrics_table: {
        accuracy: { random_forest: 0.812, xgboost: 0.831 },
        precision: { random_forest: 0.7, xgboost: 0.74 },
        recall: { random_forest: 0.65, xgboost: 0.69 },
        f1: { random_forest: 0.67, xgboost: 0.71 },
        roc_auc: { random_forest: 0.79, xgboost: 0.81 },
      },
      n_test: 2000,
    }
    vi.mocked(api.mlComparison).mockResolvedValueOnce(COMPARISON)
    vi.mocked(api.analyzeClinical).mockResolvedValueOnce({
      ...ANALYSIS,
      model_analysis: [
        ...ANALYSIS.model_analysis,
        {
          claim:
            'The XGBoost candidate model (not the production model) assigned a score of 0.63 (Moderate tier). This is a model-generated score for comparison purposes only.',
          claim_type: 'model_observation',
          evidence_ids: [],
        },
      ],
    })
    render(<ClinicalAnalysisPage />)
    const textarea = await screen.findByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: 'compare the models' } })
    fireEvent.click(screen.getByLabelText(/Compare models/))
    fireEvent.click(screen.getByRole('button', { name: /^Analyze Patient$/ }))

    await waitFor(() => expect(api.mlComparison).toHaveBeenCalled())
    expect(await screen.findByText(/assigned a score of 0.63/)).toBeDefined()
    expect(screen.getByText('0.8120')).toBeDefined()
    expect(screen.getByText('0.8310')).toBeDefined()
    expect(screen.getByText(/fixed historical test set of 2,000 records/)).toBeDefined()
  })

  it('renders the uncertainty section from backend-supplied notes only', async () => {
    render(<ClinicalAnalysisPage />)
    const textarea = await screen.findByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: 'diabetes risk' } })
    fireEvent.click(screen.getByRole('button', { name: /^Analyze Patient$/ }))
    await waitFor(() => expect(screen.getByText(/Safety review: approved/i)).toBeDefined())

    expect(screen.getByText('Uncertainty & limitations')).toBeDefined()
    expect(screen.getByText(/has not been clinically validated/)).toBeDefined()
  })

  it('shows a network error via ErrorNote rather than a fake result', async () => {
    vi.mocked(api.analyzeClinical).mockRejectedValueOnce(new Error('Cannot reach the MedGenesis API'))
    render(<ClinicalAnalysisPage />)
    const textarea = await screen.findByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: 'diabetes risk' } })
    fireEvent.click(screen.getByRole('button', { name: /^Analyze Patient$/ }))

    expect(await screen.findByText(/Cannot reach the MedGenesis API/)).toBeDefined()
    expect(screen.queryByText(/Safety review/)).toBeNull()
  })

  it('does not send a second overlapping request on a rapid double-click', async () => {
    render(<ClinicalAnalysisPage />)
    const textarea = await screen.findByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: 'diabetes risk' } })
    const button = screen.getByRole('button', { name: /^Analyze Patient$/ })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByText(/Safety review: approved/i)).toBeDefined())
    expect(api.analyzeClinical).toHaveBeenCalledTimes(1)
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
    fireEvent.click(screen.getByRole('button', { name: /^Analyze Patient$/ }))

    expect(await screen.findByText(/Simulation unavailable for this profile\/request\. No change was specified\./)).toBeDefined()
  })

  it('renders a scored simulation as a model projection, never as a clinical prediction', async () => {
    vi.mocked(api.analyzeClinical).mockResolvedValueOnce({
      ...ANALYSIS,
      simulation: {
        id: 1,
        patient_id: 4,
        status: 'scored',
        scope: 'educational_screening_only',
        label: 'Simulated scenario: physical activity increased',
        hypothesis: { phys_activity: 1 },
        trajectory: [
          { week: 0, risk_probability: 0.59, risk_tier: 'Moderate', bmi: 28.8, phys_activity: 0, smoker: 0, simulated: false },
          { week: 12, risk_probability: 0.47, risk_tier: 'Low', bmi: 28.8, phys_activity: 1, smoker: 0, simulated: true },
        ],
        assumptions: ['Linear interpolation between observed and hypothesized values.'],
        unavailable_reason: null,
        base_timeline_event_id: 10,
        summary_text: 'Projected risk score decreased from 0.59 to 0.47 over 12 weeks under the hypothesized scenario.',
        safety: ANALYSIS.safety,
        trace: [],
      },
    })
    render(<ClinicalAnalysisPage />)
    const textarea = await screen.findByPlaceholderText(/What factors are relevant/)
    fireEvent.change(textarea, { target: { value: 'what if activity increased' } })
    fireEvent.click(screen.getByLabelText(/What-if simulation/))
    fireEvent.click(screen.getByRole('button', { name: /^Analyze Patient$/ }))

    expect(await screen.findByText(/Simulated scenario: physical activity increased/)).toBeDefined()
    expect(screen.getByText(/Not a predicted clinical outcome, not a guaranteed/)).toBeDefined()
    expect(screen.getByText(/Projected risk score decreased from 0.59 to 0.47/)).toBeDefined()
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
    fireEvent.click(screen.getByRole('button', { name: /^Analyze Patient$/ }))

    expect(await screen.findByText(/Blocked by the safety layer/i)).toBeDefined()
    expect(screen.getByText(/Analysis withheld/)).toBeDefined()
    expect(screen.queryByText(/Recorded high blood pressure/)).toBeNull()
  })
})
