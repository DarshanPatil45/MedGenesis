import { useEffect, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { api } from './api/client'
import type { Health } from './api/types'
import { PatientProvider, usePatients } from './PatientContext'
import { CarePlanPage } from './pages/CarePlanPage'
import { ChatPage } from './pages/ChatPage'
import { IntakePage } from './pages/IntakePage'
import { ScreeningPage } from './pages/ScreeningPage'
import { SimulatorPage } from './pages/SimulatorPage'
import { TimelinePage } from './pages/TimelinePage'
import { TracePage } from './pages/TracePage'

const NAV = [
  { to: '/', label: 'Patient Intake', end: true },
  { to: '/timeline', label: 'Digital Twin Timeline' },
  { to: '/screening', label: 'Screening Dashboard' },
  { to: '/simulator', label: 'What-if Simulator' },
  { to: '/careplan', label: 'Care Plan' },
  { to: '/chat', label: 'Chat' },
  { to: '/trace', label: 'Agent Trace & Safety' },
]

function PatientSwitcher() {
  const { patients, selected, selectPatient } = usePatients()
  if (!patients.length) return <div className="muted">No patients yet — create one on Intake.</div>
  return (
    <label>
      Active patient
      <select
        value={selected?.id ?? ''}
        onChange={(e) => selectPatient(Number(e.target.value))}
      >
        {patients.map((p) => (
          <option key={p.id} value={p.id}>
            #{p.id} {p.pseudonym}
          </option>
        ))}
      </select>
    </label>
  )
}

function Shell() {
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
  }, [])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          MedGenesis
          <small>Agentic AI for Type 2 Diabetes education. Not a diagnostic device.</small>
        </div>
        <PatientSwitcher />
        <nav className="nav">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="muted" style={{ marginTop: 'auto', fontSize: '0.72rem' }}>
          {health ? (
            <>
              <div>db: {health.database}</div>
              <div>model: {health.screening_model}</div>
              <div>rag: {health.rag_backend}</div>
              <div>llm: {health.llm}</div>
              <div>policy: v{health.policy_version}</div>
            </>
          ) : (
            <div>backend unreachable</div>
          )}
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<IntakePage />} />
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/screening" element={<ScreeningPage />} />
          <Route path="/simulator" element={<SimulatorPage />} />
          <Route path="/careplan" element={<CarePlanPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/trace" element={<TracePage />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <PatientProvider>
      <Shell />
    </PatientProvider>
  )
}
