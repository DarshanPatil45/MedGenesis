import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { api } from './api/client'

vi.mock('./api/client', () => ({
  api: {
    health: vi.fn(),
    listPatients: vi.fn(),
    demoProfiles: vi.fn(),
  },
}))

const THEME_KEY = 'medgenesis.theme'

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  )
}

describe('App shell — theme toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    vi.mocked(api.health).mockResolvedValue({
      status: 'ok',
      database: 'sqlite (medgenesis.db)',
      screening_model: 'screening-baseline-v3-brfss2015',
      rag_backend: 'chromadb+sentence-transformers',
      llm: 'unavailable — rule-based fallback',
      policy_version: '1.1.0',
    })
    vi.mocked(api.listPatients).mockResolvedValue([])
    vi.mocked(api.demoProfiles).mockResolvedValue({})
  })

  it('defaults to light and switches to dark on click', async () => {
    renderApp()
    const toggle = await screen.findByRole('button', { name: /Switch to dark theme/ })
    expect(document.documentElement.dataset.theme).toBe('light')
    fireEvent.click(toggle)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(await screen.findByRole('button', { name: /Switch to light theme/ })).toBeDefined()
  })

  it('persists the choice to localStorage', async () => {
    renderApp()
    const toggle = await screen.findByRole('button', { name: /Switch to dark theme/ })
    fireEvent.click(toggle)
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
  })

  it('reads a previously stored preference on the next mount', async () => {
    localStorage.setItem(THEME_KEY, 'dark')
    renderApp()
    await screen.findByRole('button', { name: /Switch to light theme/ })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('toggling twice returns to light', async () => {
    renderApp()
    const toggle = await screen.findByRole('button', { name: /Switch to dark theme/ })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: /Switch to light theme/ }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
  })
})

describe('App shell — skip link and landmarks', () => {
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
    vi.mocked(api.listPatients).mockResolvedValue([])
    vi.mocked(api.demoProfiles).mockResolvedValue({})
  })

  it('renders a skip link targeting the main content landmark', async () => {
    renderApp()
    const link = await screen.findByText('Skip to main content')
    expect(link.getAttribute('href')).toBe('#main-content')
    expect(document.getElementById('main-content')).not.toBeNull()
  })

  it('renders exactly one main landmark', async () => {
    renderApp()
    await screen.findByText('Skip to main content')
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })
})

describe('App shell — header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(api.listPatients).mockResolvedValue([])
    vi.mocked(api.demoProfiles).mockResolvedValue({})
  })

  it('shows the current page name in the header, matching the active route', async () => {
    vi.mocked(api.health).mockResolvedValue({
      status: 'ok',
      database: 'sqlite (medgenesis.db)',
      screening_model: 'screening-baseline-v3-brfss2015',
      rag_backend: 'chromadb+sentence-transformers',
      llm: 'unavailable — rule-based fallback',
      policy_version: '1.1.0',
    })
    render(
      <MemoryRouter initialEntries={['/clinical-analysis']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('Skip to main content')
    expect(document.querySelector('.app-header-page')?.textContent).toBe('Clinical Analysis')
  })

  it('shows a connected status dot when the backend is reachable', async () => {
    vi.mocked(api.health).mockResolvedValue({
      status: 'ok',
      database: 'sqlite (medgenesis.db)',
      screening_model: 'screening-baseline-v3-brfss2015',
      rag_backend: 'chromadb+sentence-transformers',
      llm: 'unavailable — rule-based fallback',
      policy_version: '1.1.0',
    })
    renderApp()
    expect(await screen.findByText('Backend connected')).toBeDefined()
    expect(document.querySelector('.status-dot.down')).toBeNull()
  })

  it('shows an unreachable status dot when the health check fails', async () => {
    vi.mocked(api.health).mockRejectedValue(new Error('network error'))
    renderApp()
    expect(await screen.findByText('Backend unreachable')).toBeDefined()
    expect(document.querySelector('.status-dot.down')).not.toBeNull()
  })

  it('opens and closes the mobile nav drawer from the header toggle', async () => {
    vi.mocked(api.health).mockResolvedValue({
      status: 'ok',
      database: 'sqlite (medgenesis.db)',
      screening_model: 'screening-baseline-v3-brfss2015',
      rag_backend: 'chromadb+sentence-transformers',
      llm: 'unavailable — rule-based fallback',
      policy_version: '1.1.0',
    })
    renderApp()
    const toggle = await screen.findByRole('button', { name: 'Open navigation menu' })
    expect(document.querySelector('.sidebar-mobile')).toBeNull()

    fireEvent.click(toggle)
    expect(document.querySelector('.sidebar-mobile')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Close navigation menu' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Close navigation menu' }))
    await waitFor(() => expect(document.querySelector('.sidebar-mobile')).toBeNull())
  })
})
