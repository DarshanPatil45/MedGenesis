import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { AgentRun, AuditLogRow } from '../api/types'
import { usePatients } from '../PatientContext'
import { AgentTrace, Card, ErrorNote } from '../components/common'

const STATUS_CLASS: Record<string, string> = {
  APPROVED: 'low',
  FLAGGED_FOR_CLINICIAN_REVIEW: 'moderate',
  BLOCKED: 'high',
}

export function TracePage() {
  const { selected } = usePatients()
  const [run, setRun] = useState<AgentRun | null>(null)
  const [log, setLog] = useState<AuditLogRow[]>([])
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadLog = useCallback(async () => {
    try {
      setLog(await api.auditLog())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void loadLog()
    api.safetyPolicy().then(setPolicy).catch(() => setPolicy(null))
  }, [loadLog])

  const runPipeline = async (mode: string) => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      setRun(await api.runPipeline(selected.id, mode))
      await loadLog()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Agent Trace &amp; Safety Log</h1>
      <p className="muted">
        The "show your work" screen: which agents ran in what order, and how the safety gate
        judged each output. The audit log is append-only.
      </p>
      <ErrorNote error={error} />

      <Card title="Run the full pipeline">
        {selected ? (
          <div className="row">
            <button onClick={() => runPipeline('intake')} disabled={busy}>
              Run intake pipeline
            </button>
            <button className="secondary" onClick={() => runPipeline('simulation')} disabled={busy}>
              Run simulation route
            </button>
            <span className="muted">
              patient #{selected.id} — {selected.pseudonym}
            </span>
          </div>
        ) : (
          <p className="muted">Select a patient on the Intake page first.</p>
        )}
      </Card>

      {run && (
        <Card title={`Trace (mode: ${run.mode})`}>
          <AgentTrace trace={run.trace} />
          <p className="muted" style={{ marginTop: '0.8rem' }}>
            Overall safety verdict: <strong>{run.safety.status}</strong> (policy v
            {run.safety.policy_version})
          </p>
        </Card>
      )}

      <Card title={`Safety audit log (${log.length} entries)`}>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>When</th>
              <th>Target</th>
              <th>Status</th>
              <th>Reasons</th>
              <th>Policy</th>
            </tr>
          </thead>
          <tbody>
            {log.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{new Date(row.reviewed_at).toLocaleString()}</td>
                <td>
                  {row.target_type} #{row.target_id}
                </td>
                <td>
                  <span className={`badge ${STATUS_CLASS[row.status] ?? 'neutral'}`}>
                    {row.status}
                  </span>
                </td>
                <td className="muted">
                  {row.reasons.length ? (
                    <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                      {row.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="muted">v{row.policy_version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {policy && (
        <Card title="Active safety policy">
          <p className="muted" style={{ marginTop: 0 }}>
            Rules are declared in <code>safety_policies.yaml</code> and applied deterministically —
            not judged by an LLM — so the same output always yields the same decision.
          </p>
          <dl className="kv">
            <dt>Policy version</dt>
            <dd>{String(policy.policy_version)}</dd>
            <dt>Blocking rules</dt>
            <dd>
              {(policy.blocked_rules as { id: string; pattern_count: number }[] | undefined)
                ?.map((r) => `${r.id} (${r.pattern_count} patterns)`)
                .join(', ') ?? '—'}
            </dd>
            <dt>Disclaimer required for</dt>
            <dd>{(policy.disclaimer_required_for as string[] | undefined)?.join(', ') ?? '—'}</dd>
          </dl>
        </Card>
      )}
    </>
  )
}
