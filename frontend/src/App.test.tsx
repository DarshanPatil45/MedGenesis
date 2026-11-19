import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { api } from './api/client'
import type { Patient } from './api/types'

vi.mock('./api/client', () => ({
  api: {
    health: vi.fn(),
    listPatients: vi.fn(),
    demoProfiles: vi.fn(),
    auditLog: vi.fn(),
    safetyPolicy: vi.fn(),
    timeline: vi.fn(),
    mlComparison: vi.fn(),
  },
}))

const PATIENT: Patient = {
  id: 7,
  pseudonym: 'Demo Patient B (moderate risk)',
  age: 52,
  sex: 'female',
  is_synthetic: true,
  screening_eligible: true,
  created_at: '2026-01-01T00:00:00Z',
}

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('AppShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(api.health).mockResolvedValue({
      status: 'ok',
      database: 'sqlite (medgenesis.db)',
      screening_model: 'screening-baseline-v3-brfss2015',
      rag_backend: 'chromadb+sentence-transformers',
      llm: 'unavailable — rule-based fallback',
      policy_version: '1.1.0',
    })
    vi.mocked(api.listPatients).mockResolvedValue([PATIENT])
    vi.mocked(api.demoProfiles).mockResolvedValue({})
    vi.mocked(api.auditLog).mockResolvedValue([])
    vi.mocked(api.safetyPolicy).mockResolvedValue({} as never)
    vi.mocked(api.timeline).mockResolvedValue({ patient_id: 7, events: [], current_state: {} })
    vi.mocked(api.mlComparison).mockRejectedValue(new Error('not needed'))
  })

  it('renders a skip link pointing at the main landmark', async () => {
    renderApp()
    const link = await screen.findByText('Skip to main content')
    expect(link.getAttribute('href')).toBe('#main')
    expect(document.getElementById('main')).not.toBeNull()
  })

  it('renders exactly one main landmark', async () => {
    renderApp()
    await screen.findByText('Skip to main content')
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('has no persistent sidebar — navigation lives in the top command bar', async () => {
    renderApp()
    await screen.findByText('Skip to main content')
    expect(screen.queryByRole('complementary')).toBeNull()
    const banner = screen.getByRole('banner')
    expect(within(banner).getByRole('navigation', { name: 'Journey' })).toBeDefined()
  })

  it('shows the persistent safety disclaimer on every route', async () => {
    const expected = 'Synthetic data. Educational use only. Not medical advice or a diagnostic device.'
    for (const path of ['/', '/twin', '/safety', '/careplan', '/chat']) {
      const { unmount } = renderApp(path)
      await screen.findByText('Skip to main content')
      expect(screen.getAllByText(expected).length).toBeGreaterThan(0)
      unmount()
    }
  })

  it('marks the journey stage for the current route with aria-current', async () => {
    renderApp('/twin')
    await screen.findByText('Skip to main content')
    const current = screen.getByRole('link', { current: 'step' })
    expect(current.textContent).toBe('Digital Twin')
  })

  it('opens the mobile route menu from the command bar', async () => {
    renderApp()
    const toggle = await screen.findByRole('button', { name: 'Open menu' })
    expect(document.getElementById('app-mobile-nav')).toBeNull()

    fireEvent.click(toggle)
    expect(document.getElementById('app-mobile-nav')).not.toBeNull()
    expect(screen.getByRole('navigation', { name: 'All screens' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    await waitFor(() => expect(document.getElementById('app-mobile-nav')).toBeNull())
  })

  it('surfaces the selected patient in the command bar chip', async () => {
    renderApp()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Selected patient: Demo Patient B/ })).toBeDefined(),
    )
  })
})
