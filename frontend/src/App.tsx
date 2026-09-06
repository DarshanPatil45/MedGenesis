import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { api } from './api/client'
import type { Health } from './api/types'
import { Header } from './components/layout/Header'
import { MobileNav } from './components/layout/MobileNav'
import { NAV } from './components/layout/nav'
import { PatientContextBar } from './components/layout/PatientContextBar'
import { Sidebar } from './components/layout/Sidebar'
import { PatientProvider } from './PatientContext'
import { CarePlanPage } from './pages/CarePlanPage'
import { ChatPage } from './pages/ChatPage'
import { ClinicalAnalysisPage } from './pages/ClinicalAnalysisPage'
import { IntakePage } from './pages/IntakePage'
import { ScreeningPage } from './pages/ScreeningPage'
import { SimulatorPage } from './pages/SimulatorPage'
import { TimelinePage } from './pages/TimelinePage'
import { TracePage } from './pages/TracePage'

const THEME_KEY = 'medgenesis.theme'
type Theme = 'light' | 'dark'

function getStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    return raw === 'light' || raw === 'dark' ? raw : null
  } catch {
    return null
  }
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = getStoredTheme()
    if (stored) return stored
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(THEME_KEY, next)
      } catch {
        /* private browsing — preference just won't persist */
      }
      return next
    })
  }, [])

  return { theme, toggle }
}

function Shell() {
  const [health, setHealth] = useState<Health | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()
  const { theme, toggle: toggleTheme } = useTheme()
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
  }, [])

  // Close the mobile nav automatically after navigating — otherwise it
  // stays open over the new page's content.
  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname])

  const currentPage = NAV.find((item) => item.to === location.pathname)?.label ?? ''

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <Header
        health={health}
        theme={theme}
        toggleTheme={toggleTheme}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        currentPage={currentPage}
      />

      <div className="app-body">
        <MobileNav open={navOpen} reduceMotion={!!reduceMotion} />
        <Sidebar health={health} />

        <main className="main" id="main-content" tabIndex={-1}>
          <PatientContextBar />
          <Routes>
            <Route path="/" element={<IntakePage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/screening" element={<ScreeningPage />} />
            <Route path="/simulator" element={<SimulatorPage />} />
            <Route path="/careplan" element={<CarePlanPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/clinical-analysis" element={<ClinicalAnalysisPage />} />
            <Route path="/trace" element={<TracePage />} />
          </Routes>
        </main>
      </div>
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
