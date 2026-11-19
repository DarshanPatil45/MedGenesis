import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { PatientProvider } from '../PatientContext'
import type { Patient } from '../api/types'
import { CommandPalette } from './CommandPalette'

vi.mock('../api/client', () => ({ api: { listPatients: vi.fn() } }))

const PATIENTS: Patient[] = [
  {
    id: 3,
    pseudonym: 'Demo Patient B (moderate risk)',
    age: 52,
    sex: 'female',
    is_synthetic: true,
    screening_eligible: true,
    created_at: '2026-01-01T00:00:00Z',
  },
]

function renderPalette() {
  return render(
    <MemoryRouter>
      <PatientProvider>
        <CommandPalette />
      </PatientProvider>
    </MemoryRouter>,
  )
}

const openPalette = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Open command palette' }))
  return screen.findByRole('listbox', { name: 'Results' })
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(api.listPatients).mockResolvedValue(PATIENTS)
  })

  it('opens on ⌘K and closes on a second press', async () => {
    renderPalette()
    await screen.findByRole('button', { name: 'Open command palette' })
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(await screen.findByRole('listbox', { name: 'Results' })).toBeDefined()

    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  })

  it('opens on Ctrl+K for non-mac keyboards', async () => {
    renderPalette()
    await screen.findByRole('button', { name: 'Open command palette' })
    fireEvent.keyDown(window, { key: 'K', ctrlKey: true })
    expect(await screen.findByRole('listbox', { name: 'Results' })).toBeDefined()
  })

  it('marks exactly one option selected and moves it with ArrowDown', async () => {
    renderPalette()
    await openPalette()

    const selected = () =>
      screen.getAllByRole('option').findIndex((o) => o.getAttribute('aria-selected') === 'true')
    expect(screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(1)
    expect(selected()).toBe(0)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowDown' })
    await waitFor(() => expect(selected()).toBe(1))
  })

  it('wraps from the first option to the last on ArrowUp', async () => {
    renderPalette()
    await openPalette()
    const count = screen.getAllByRole('option').length

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowUp' })
    await waitFor(() => {
      const i = screen.getAllByRole('option').findIndex((o) => o.getAttribute('aria-selected') === 'true')
      expect(i).toBe(count - 1)
    })
  })

  /**
   * Ranking regression guard. A flat subsequence match ranked five patients
   * above "Digital Twin" for "dtw", because "Demo Patient A (lower risk)"
   * genuinely contains d…t…w. These assert the *first* result, not merely
   * that the right row exists somewhere.
   */
  it.each([
    ['cp', 'Care Plan'],
    ['dt', 'Digital Twin'],
    ['wi', 'What-if'],
    ['at', 'Agent Trace'],
    ['twin', 'Digital Twin'],
  ])('ranks %s first for "%s"', async (query, expected) => {
    renderPalette()
    await openPalette()
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a patient or screen' }), {
      target: { value: query },
    })
    await waitFor(() => {
      expect(screen.getAllByRole('option')[0].textContent).toContain(expected)
    })
  })

  it('finds a real patient by id and closes when chosen', async () => {
    renderPalette()
    await openPalette()
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a patient or screen' }), {
      target: { value: '3' },
    })
    const hit = await screen.findByText('Demo Patient B (moderate risk)')

    fireEvent.click(hit)
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  })

  it('reports no match rather than showing an empty list', async () => {
    renderPalette()
    await openPalette()
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a patient or screen' }), {
      target: { value: 'zzzzzz' },
    })
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0))
    expect(screen.getByText(/No patient or screen matches/)).toBeDefined()
  })
})
