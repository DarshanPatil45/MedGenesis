import type {
  AgentRun,
  AuditLogRow,
  CarePlan,
  ChatResponse,
  ClinicalAnalysis,
  DemoProfile,
  DigitalTwin,
  Health,
  LabTrend,
  ModelComparison,
  Patient,
  Screening,
  Simulation,
  Timeline,
} from './types'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

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
    throw new ApiError(
      `Cannot reach the MedGenesis API at ${BASE_URL}. Is the backend running?`,
      0,
    )
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
  appendEvent: (patientId: number, body: { event_type: string; payload: Record<string, unknown> }) =>
    post(`/api/twin/${patientId}/events`, { ...body, source: 'real' }),
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

  auditLog: () => request<AuditLogRow[]>('/api/safety/audit-log?limit=200'),
  safetyPolicy: () => request<Record<string, unknown>>('/api/safety/policy'),

  mlComparison: () => request<ModelComparison>('/api/ml/comparison'),
}
