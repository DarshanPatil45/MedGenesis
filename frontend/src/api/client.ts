import type {
  AgentRun,
  AuditLogRow,
  CarePlan,
  ChatResponse,
  ClinicalAnalysis,
  DemoProfile,
  DigitalTwin,
  EvidenceSearch,
  Health,
  LabTrend,
  ModelComparison,
  Patient,
  Screening,
  Simulation,
  Timeline,
  TimelineEvent,
  XGBoostPredictOut,
} from './types'

// Empty by default so requests go through Vite's dev proxy (see
// vite.config.ts, which forwards /api to the FastAPI backend) — set
// VITE_API_BASE_URL to hit a backend on a different origin.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let resp: Response
  try {
    resp = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch {
    throw new ApiError('Cannot reach the MedGenesis API. Is the backend running?', 0)
  }
  if (!resp.ok) {
    let detail = `${resp.status} ${resp.statusText}`
    try {
      const body = await resp.json()
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* response had no JSON body */
    }
    throw new ApiError(detail, resp.status)
  }
  return resp.json() as Promise<T>
}

const post = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const api = {
  health: () => request<Health>('/api/health'),

  listPatients: () => request<Patient[]>('/api/patients'),
  getPatient: (id: number) => request<Patient>(`/api/patients/${id}`),
  demoProfiles: () => request<Record<string, DemoProfile>>('/api/patients/demo-profiles'),
  createDemoPatient: (profile: string) =>
    post<Patient>('/api/patients/demo', { profile, months_of_history: 6 }),
  createPatient: (body: {
    pseudonym: string
    age: number
    sex: string
    baseline_measurements?: Record<string, number>
  }) => post<Patient>('/api/patients', body),

  timeline: (patientId: number) => request<Timeline>(`/api/twin/${patientId}/timeline`),
  // Backend responds with TimelineEventOut (routers/twin.py); typed
  // explicitly so callers get the created event back, not `unknown`.
  // `recorded_at` is optional — schemas.TimelineEventCreate already accepts
  // it and defaults to "now" server-side when omitted (twin_service
  // .append_event); passing it lets a backdated clinical entry (e.g. a lab
  // result from a visit last week) carry its true date.
  appendEvent: (
    patientId: number,
    body: { event_type: string; payload: Record<string, unknown>; recorded_at?: string },
  ) => post<TimelineEvent>(`/api/twin/${patientId}/events`, { ...body, source: 'real' }),
  digitalTwin: (patientId: number) => request<DigitalTwin>(`/api/twin/${patientId}/digital-twin`),
  labTrend: (patientId: number, testName: string) =>
    request<LabTrend>(`/api/twin/${patientId}/labs/${encodeURIComponent(testName)}`),

  runScreening: (patientId: number) => post<Screening>('/api/screening/run', { patient_id: patientId }),
  simulate: (patientId: number, hypothesis: Record<string, number>, text?: string) =>
    post<Simulation>('/api/simulate', { patient_id: patientId, hypothesis, text: text ?? null }),
  generateCarePlan: (patientId: number) =>
    post<CarePlan>('/api/careplan/generate', { patient_id: patientId, use_llm: true }),
  chat: (patientId: number, message: string, sessionId: number | null) =>
    post<ChatResponse>('/api/chat', {
      patient_id: patientId,
      message,
      session_id: sessionId,
      use_llm: true,
    }),
  runPipeline: (patientId: number, mode: string) =>
    post<AgentRun>('/api/agents/run', { patient_id: patientId, mode, use_llm: true }),

  analyzeClinical: (
    patientId: number,
    question: string,
    options: {
      includeEvidence: boolean
      includePubmed: boolean
      includeModelComparison: boolean
      includeSimulation: boolean
    },
  ) =>
    post<ClinicalAnalysis>('/api/clinical/analyze', {
      patient_id: patientId,
      question,
      include_evidence: options.includeEvidence,
      include_pubmed: options.includePubmed,
      include_model_comparison: options.includeModelComparison,
      include_simulation: options.includeSimulation,
      use_llm: true,
    }),

  searchEvidence: (query: string, source: 'local' | 'pubmed' | 'all' = 'local', k?: number) =>
    post<EvidenceSearch>('/api/evidence/search', { query, source, k: k ?? null }),

  auditLog: () => request<AuditLogRow[]>('/api/safety/audit-log?limit=200'),
  safetyPolicy: () => request<Record<string, unknown>>('/api/safety/policy'),

  mlComparison: () => request<ModelComparison>('/api/ml/comparison'),

  /** Candidate-model score for one patient — comparison only, never production. */
  xgboostPredict: (patientId: number) =>
    post<XGBoostPredictOut>('/api/ml/xgboost/predict', { patient_id: patientId }),
}
