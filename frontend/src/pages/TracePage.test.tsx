import { render, screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { AuditLogRow, Patient } from '../api/types'
import { usePatients } from '../PatientContext'
import { TracePage } from './TracePage'

vi.mock('../api/client', () => ({
  api: {
    auditLog: vi.fn(),
    safetyPolicy: vi.fn(),
    runPipeline: vi.fn(),
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
  usePatients: vi.fn(),
}))

const LOG: AuditLogRow[] = [
  { id: 3, target_type: 'clinical_analysis', target_id: '4', status: 'APPROVED', reasons: [], policy_version: '1.1.0', reviewed_at: '2026-08-28T12:00:00Z' },
  { id: 2, target_type: 'chat', target_id: '4', status: 'FLAGGED_FOR_CLINICIAN_REVIEW', reasons: ['[urgent_symptoms] possible urgent symptoms mentioned'], policy_version: '1.1.0', reviewed_at: '2026-08-28T11:00:00Z' },
  { id: 1, target_type: 'chat', target_id: '4', status: 'BLOCKED', reasons: ["[medication_advice] matched: 'start taking'"], policy_version: '1.1.0', reviewed_at: '2026-08-28T10:00:00Z' },
]

describe('TracePage audit log filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(usePatients).mockReturnValue({
      patients: [PATIENT],
      selected: PATIENT,
      selectPatient: vi.fn(),
      refresh: vi.fn(),
      loading: false,
      error: null,
    })
    vi.mocked(api.auditLog).mockResolvedValue(LOG)
    vi.mocked(api.safetyPolicy).mockResolvedValue(null as never)
  })

  it('shows every entry by default', async () => {
    render(<TracePage />)
    expect(await screen.findByText('Safety audit log (3 entries)')).toBeDefined()
    const table = screen.getByRole('table')
    expect(within(table).getByText('APPROVED')).toBeDefined()
    expect(within(table).getByText('FLAGGED_FOR_CLINICIAN_REVIEW')).toBeDefined()
    expect(within(table).getByText('BLOCKED')).toBeDefined()
  })

  it('narrows the table to BLOCKED entries only', async () => {
    render(<TracePage />)
    await screen.findByText('Safety audit log (3 entries)')
    const select = screen.getByLabelText(/Filter by status/)
    fireEvent.change(select, { target: { value: 'BLOCKED' } })
    const table = screen.getByRole('table')
    expect(within(table).getByText('BLOCKED')).toBeDefined()
    expect(within(table).queryByText('APPROVED')).toBeNull()
    expect(within(table).queryByText('FLAGGED_FOR_CLINICIAN_REVIEW')).toBeNull()
    expect(screen.getByText('1 of 3 shown')).toBeDefined()
  })

  it('shows an honest empty state when no entry matches the filter', async () => {
    vi.mocked(api.auditLog).mockResolvedValue(LOG.filter((r) => r.status !== 'BLOCKED'))
    render(<TracePage />)
    await waitFor(() => expect(screen.getByText('Safety audit log (2 entries)')).toBeDefined())
    const select = screen.getByLabelText(/Filter by status/)
    fireEvent.change(select, { target: { value: 'BLOCKED' } })
    expect(screen.getByText(/No audit entries match this filter/)).toBeDefined()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('returning the filter to "all" restores every entry', async () => {
    render(<TracePage />)
    await screen.findByText('Safety audit log (3 entries)')
    const select = screen.getByLabelText(/Filter by status/)
    fireEvent.change(select, { target: { value: 'APPROVED' } })
    expect(within(screen.getByRole('table')).queryByText('BLOCKED')).toBeNull()
    fireEvent.change(select, { target: { value: 'all' } })
    expect(within(screen.getByRole('table')).getByText('BLOCKED')).toBeDefined()
  })
})
