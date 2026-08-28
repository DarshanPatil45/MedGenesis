import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import type { Patient } from '../api/types'
import { usePatients } from '../PatientContext'
import { IntakePage } from './IntakePage'

vi.mock('../api/client', () => ({
  api: {
    demoProfiles: vi.fn(),
    createDemoPatient: vi.fn(),
    createPatient: vi.fn(),
  },
}))

vi.mock('../PatientContext', () => ({
  usePatients: vi.fn(),
}))

function makePatient(id: number, pseudonym: string, overrides: Partial<Patient> = {}): Patient {
  return {
    id,
    pseudonym,
    age: 40,
    sex: 'female',
    is_synthetic: true,
    screening_eligible: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const SMALL_LIST: Patient[] = [
  makePatient(1, 'Demo Patient A (lower risk)'),
  makePatient(2, 'Demo Patient B (moderate risk)'),
  makePatient(3, 'Demo Patient C (incomplete history)', { screening_eligible: false }),
]

const LARGE_LIST: Patient[] = [
  ...SMALL_LIST,
  makePatient(4, 'Participant 004'),
  makePatient(5, 'Participant 005'),
  makePatient(6, 'Participant 006'),
]

function mockPatients(patients: Patient[]) {
  vi.mocked(usePatients).mockReturnValue({
    patients,
    selected: patients[0] ?? null,
    selectPatient: vi.fn(),
    refresh: vi.fn(),
    loading: false,
    error: null,
  })
}

describe('IntakePage patient filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.demoProfiles).mockResolvedValue({})
  })

  it('does not show a filter box for a small patient list', async () => {
    mockPatients(SMALL_LIST)
    render(<IntakePage />)
    expect(await screen.findByText('Patients (3)')).toBeDefined()
    expect(screen.queryByLabelText(/Filter/)).toBeNull()
    for (const p of SMALL_LIST) {
      expect(screen.getByText(p.pseudonym)).toBeDefined()
    }
  })

  it('shows a filter box once the list grows past the threshold', async () => {
    mockPatients(LARGE_LIST)
    render(<IntakePage />)
    expect(await screen.findByText('Patients (6)')).toBeDefined()
    expect(screen.getByLabelText(/Filter/)).toBeDefined()
  })

  it('narrows the table by pseudonym', async () => {
    mockPatients(LARGE_LIST)
    render(<IntakePage />)
    const filter = await screen.findByLabelText(/Filter/)
    fireEvent.change(filter, { target: { value: 'Participant 005' } })
    expect(screen.getByText('Participant 005')).toBeDefined()
    expect(screen.queryByText('Demo Patient A (lower risk)')).toBeNull()
    expect(screen.getByText('1 of 6 shown')).toBeDefined()
  })

  it('narrows the table by patient ID', async () => {
    mockPatients(LARGE_LIST)
    render(<IntakePage />)
    const filter = await screen.findByLabelText(/Filter/)
    fireEvent.change(filter, { target: { value: '3' } })
    expect(screen.getByText('Demo Patient C (incomplete history)')).toBeDefined()
    expect(screen.queryByText('Demo Patient A (lower risk)')).toBeNull()
  })

  it('is case-insensitive', async () => {
    mockPatients(LARGE_LIST)
    render(<IntakePage />)
    const filter = await screen.findByLabelText(/Filter/)
    fireEvent.change(filter, { target: { value: 'PARTICIPANT' } })
    expect(screen.getByText('Participant 004')).toBeDefined()
    expect(screen.getByText('Participant 005')).toBeDefined()
    expect(screen.getByText('Participant 006')).toBeDefined()
    expect(screen.queryByText('Demo Patient A (lower risk)')).toBeNull()
  })

  it('shows an honest empty state instead of an empty table when nothing matches', async () => {
    mockPatients(LARGE_LIST)
    render(<IntakePage />)
    const filter = await screen.findByLabelText(/Filter/)
    fireEvent.change(filter, { target: { value: 'zzz_no_such_patient' } })
    expect(screen.getByText(/No patients match/)).toBeDefined()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('clearing the filter restores the full list', async () => {
    mockPatients(LARGE_LIST)
    render(<IntakePage />)
    const filter = await screen.findByLabelText(/Filter/)
    fireEvent.change(filter, { target: { value: 'Participant 005' } })
    expect(screen.queryByText('Demo Patient A (lower risk)')).toBeNull()
    fireEvent.change(filter, { target: { value: '' } })
    expect(screen.getByText('Demo Patient A (lower risk)')).toBeDefined()
    expect(screen.getByText('Participant 006')).toBeDefined()
  })
})
