import { Activity, Menu, Moon, Sun, X } from 'lucide-react'
import type { Health } from '../../api/types'
import { usePatients } from '../../PatientContext'

function PatientSwitcher() {
  const { patients, selected, selectPatient } = usePatients()
  if (!patients.length) {
    return <div className="muted header-patient-empty">No patients yet — create one on Intake.</div>
  }
  return (
    <label className="header-patient-switcher">
      <span className="sr-only">Active patient</span>
      <select value={selected?.id ?? ''} onChange={(e) => selectPatient(Number(e.target.value))}>
        {patients.map((p) => (
          <option key={p.id} value={p.id}>
            #{p.id} {p.pseudonym}
          </option>
        ))}
      </select>
    </label>
  )
}

function ConnectionStatus({ health }: { health: Health | null }) {
  return (
    <span
      className={`status-dot${health ? ' ok' : ' down'}`}
      title={health ? `Connected — policy v${health.policy_version}` : 'Backend unreachable'}
    >
      <span aria-hidden="true" />
      <span className="sr-only">{health ? 'Backend connected' : 'Backend unreachable'}</span>
    </span>
  )
}

export function Header({
  health,
  theme,
  toggleTheme,
  navOpen,
  onToggleNav,
  currentPage,
}: {
  health: Health | null
  theme: 'light' | 'dark'
  toggleTheme: () => void
  navOpen: boolean
  onToggleNav: () => void
  currentPage: string
}) {
  return (
    <header className="app-header">
      <div className="app-header-brand">
        <span className="brand-mark" aria-hidden="true">
          <Activity size={18} strokeWidth={2.3} />
        </span>
        <span className="brand-name">
          MedGenesis
          <small>AI Clinical Decision Support</small>
        </span>
      </div>

      {currentPage && <div className="app-header-page">{currentPage}</div>}

      <div className="app-header-actions">
        <PatientSwitcher />
        <ConnectionStatus health={health} />
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          type="button"
          className="theme-toggle nav-toggle"
          aria-expanded={navOpen}
          aria-controls="primary-nav"
          aria-label={navOpen ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={onToggleNav}
        >
          {navOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>
    </header>
  )
}
