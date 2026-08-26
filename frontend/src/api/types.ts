export type SafetyStatus = 'APPROVED' | 'FLAGGED_FOR_CLINICIAN_REVIEW' | 'BLOCKED'

export interface Safety {
  status: SafetyStatus
  reasons: string[]
  disclaimer: string | null
  banner: string | null
  policy_version: string
}

export interface Patient {
  id: number
  pseudonym: string
  age: number
  sex: string
  is_synthetic: boolean
  screening_eligible: boolean
  created_at: string
}

export interface DemoProfile {
  pseudonym: string
  age: number
  sex: string
  screening_eligible: boolean
}

export interface TimelineEvent {
  id: number
  patient_id: number
  event_type: string
  payload: Record<string, unknown>
  source: string
  recorded_at: string
}

export interface Timeline {
  patient_id: number
  events: TimelineEvent[]
  current_state: Record<string, unknown>
}

export interface Screening {
  id: number | null
  patient_id: number
  status: 'scored' | 'unavailable_for_profile'
  scope: string
  disclaimer: string
  risk_probability: number | null
  risk_tier: string | null
  unavailable_reason: string | null
  top_features: Record<string, number>
  model_version: string
  summary_text: string
  safety: Safety
  trace: string[]
}

export interface TrajectoryPoint {
  week: number
  risk_probability: number
  risk_tier: string
  bmi: number | null
  phys_activity: number | null
  smoker: number | null
  simulated: boolean
}

export interface Simulation {
  id: number | null
  patient_id: number
  status: 'scored' | 'unavailable_for_profile'
  scope: string
  label: string
  hypothesis: Record<string, number>
  trajectory: TrajectoryPoint[]
  assumptions: string[]
  unavailable_reason: string | null
  base_timeline_event_id: number | null
  summary_text: string
  safety: Safety
  trace: string[]
}

export interface EvidenceSource {
  text: string
  section: string
  title: string
  publisher: string
  source_url: string
  accessed: string
  license: string
  attribution: string
  score: number
}

export interface CarePlan {
  id: number | null
  patient_id: number
  diet_focus: string
  activity_target: string
  monitoring_frequency: string
  follow_up_weeks: number
  narrative_text: string
  notes: string[]
  sources: EvidenceSource[]
  generated_by: string
  risk_tier: string | null
  screening: Record<string, unknown>
  safety: Safety
  trace: string[]
}

export interface ChatResponse {
  session_id: number
  reply_text: string
  sources: EvidenceSource[]
  generated_by: string
  tools_used: string[]
  safety: Safety
  trace: string[]
}

export interface AuditLogRow {
  id: number
  target_type: string
  target_id: string
  status: SafetyStatus
  reasons: string[]
  policy_version: string
  reviewed_at: string
}

export interface Health {
  status: string
  database: string
  screening_model: string
  rag_backend: string
  llm: string
  policy_version: string
}

export interface AgentRun {
  patient_id: number
  mode: string
  screening: Screening | null
  evidence: EvidenceSource[] | null
  simulation: Simulation | null
  care_plan: CarePlan | null
  chat: ChatResponse | null
  safety: Safety
  trace: string[]
}
