import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api/client'
import type { Patient } from './api/types'

interface PatientContextValue {
  patients: Patient[]
  selected: Patient | null
  selectPatient: (id: number) => void
  refresh: () => Promise<void>
  loading: boolean
  error: string | null
}

const PatientCtx = createContext<PatientContextValue | null>(null)

const STORAGE_KEY = 'medgenesis.selectedPatientId'

export function PatientProvider({ children }: { children: ReactNode }) {
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? Number(raw) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.listPatients()
      setPatients(list)
      setError(null)
      setSelectedId((current) =>
        current && list.some((p) => p.id === current) ? current : (list[0]?.id ?? null),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selectPatient = useCallback((id: number) => {
    setSelectedId(id)
    try {
      localStorage.setItem(STORAGE_KEY, String(id))
    } catch {
      /* private browsing — selection just won't persist */
    }
  }, [])

  const value = useMemo(
    () => ({
      patients,
      selected: patients.find((p) => p.id === selectedId) ?? null,
      selectPatient,
      refresh,
      loading,
      error,
    }),
    [patients, selectedId, selectPatient, refresh, loading, error],
  )

  return <PatientCtx.Provider value={value}>{children}</PatientCtx.Provider>
}

export function usePatients() {
  const ctx = useContext(PatientCtx)
  if (!ctx) throw new Error('usePatients must be used inside a PatientProvider')
  return ctx
}
