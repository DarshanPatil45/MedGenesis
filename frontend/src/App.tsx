import { Route, Routes } from 'react-router-dom'
import { AssessmentPage } from './features/assessment/AssessmentPage'
import { CarePlanPage } from './features/careplan/CarePlanPage'
import { ChatPage } from './features/chat/ChatPage'
import { IntakePage } from './features/intake/IntakePage'
import { SafetyPage } from './features/safety/SafetyPage'
import { AgentTracePage } from './features/trace/AgentTracePage'
import { DigitalTwinPage } from './features/twin/DigitalTwinPage'
import { WhatIfPage } from './features/whatif/WhatIfPage'
import { AppShell } from './layouts/AppShell'
import { PatientProvider } from './PatientContext'

export default function App() {
  return (
    <PatientProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<IntakePage />} />
          <Route path="/twin" element={<DigitalTwinPage />} />
          <Route path="/assessment" element={<AssessmentPage />} />
          <Route path="/simulator" element={<WhatIfPage />} />
          <Route path="/careplan" element={<CarePlanPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/trace" element={<AgentTracePage />} />
          <Route path="/safety" element={<SafetyPage />} />
        </Routes>
      </AppShell>
    </PatientProvider>
  )
}
