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
  document_id: string
  section: string
  title: string
  publisher: string
  source_url: string
  accessed: string
  license: string
  attribution: string
  score: number
  source_type: string
  doi: string
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

// --- Phase 6/7: Clinical Analysis Agent ---

export type ClaimType =
  | 'patient_observation'
  | 'model_observation'
  | 'evidence_supported'
  | 'inference'
  | 'uncertainty'

export interface ClinicalClaim {
  claim: string
  claim_type: ClaimType
  evidence_ids: string[]
}

export interface ClinicalAnalysis {
  patient_id: number
  question: string
  status: string
  scope: string
  patient_summary: ClinicalClaim[]
  model_analysis: ClinicalClaim[]
  evidence_findings: EvidenceSource[]
  simulation: Simulation | null
  integrated_analysis: ClinicalClaim[]
  uncertainties: string[]
  citations: string[]
  safety_flags: string[]
  unavailable_reason: string | null
  generated_by: string
  production_risk_tier: string | null
  safety: Safety
  trace: string[]
}

// --- Phase 2 Digital Twin endpoints (existed since Phase 2, first
// consumed by the frontend in Phase 7's Clinical Analysis page) ---

export interface LabRecord {
  test_name: string
  value: number
  unit?: string
  recorded_at: string
  [key: string]: unknown
}

export type LabTrendLabel = 'no_data' | 'insufficient_data' | 'stable' | 'increasing' | 'decreasing' | 'mixed'

export interface LabTrend {
  test_name: string
  latest: LabRecord | null
  history: LabRecord[]
  trend: LabTrendLabel
}

export interface MedicationRecord {
  medication_name: string
  action: string
  dose?: string
  recorded_at: string
  [key: string]: unknown
}

export interface DigitalTwin {
  patient: Record<string, unknown>
  clinical: Record<string, unknown>
  laboratory: { latest: Record<string, LabRecord>; history: LabRecord[] }
  medications: { current: MedicationRecord[]; history: MedicationRecord[] }
  lifestyle: Record<string, unknown>
  timeline: Record<string, unknown>[]
}

// --- Phase 3 model-comparison endpoint (existed since Phase 3, first
// consumed by the frontend in this polish pass — GET /api/ml/comparison) ---

export interface ModelMetrics {
  model_version: string
  algorithm: string
  test_metrics: Record<string, number>
  confusion_matrix: Record<string, number>
  training_time_seconds: number | null
  inference_time_seconds_test_set: number
  inference_time_seconds_per_1000_rows: number
  model_size_bytes: number
  feature_importances: Record<string, number>
}

export interface ModelComparison {
  random_forest: ModelMetrics
  xgboost: ModelMetrics
  metrics_table: Record<string, Record<string, number>>
  n_test: number
}
