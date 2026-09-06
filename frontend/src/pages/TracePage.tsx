import { CheckCircle2, FileCheck, PlayCircle, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { api } from '../api/client'
import type { AgentRun, AuditLogRow } from '../api/types'
import { usePatients } from '../PatientContext'
import { ErrorNote } from '../components/common'

const STATUS_CLASS: Record<string, string> = {
  APPROVED: 'low',
  FLAGGED_FOR_CLINICIAN_REVIEW: 'moderate',
  BLOCKED: 'high',
}

const STATUS_FILTERS = ['all', 'APPROVED', 'FLAGGED_FOR_CLINICIAN_REVIEW', 'BLOCKED'] as const

// Real trace strings look like "OrchestratorAgent: routing mode='clinical'
// for patient 4." — split on the first colon into an agent name and its
// detail so each real line becomes one connected pipeline node. Falls back
// to showing the whole line as the node label if there's no colon.
function splitTraceLine(line: string): { agent: string; detail: string | null } {
  const idx = line.indexOf(':')
  if (idx === -1) return { agent: line, detail: null }
  return { agent: line.slice(0, idx), detail: line.slice(idx + 1).trim() }
}

function PipelineFlow({ trace }: { trace: string[] }) {
  const reduceMotion = useReducedMotion()
  if (!trace?.length) return null
  return (
    <div className="pipeline">
      {trace.map((line, i) => {
        const { agent, detail } = splitTraceLine(line)
        return (
          <motion.div
            key={i}
            className="pipeline-node"
            initial={reduceMotion ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: reduceMotion ? 0 : i * 0.08, duration: 0.25, ease: [0.2, 0, 0, 1] }}
          >
            <div className="pipeline-node-rail">
              <span className="pipeline-node-dot">
                <CheckCircle2 size={15} />
              </span>
              {i < trace.length - 1 && <span className="pipeline-node-line" />}
            </div>
            <div className="pipeline-node-body">
              <div className="pipeline-node-agent">{agent}</div>
              {detail && <div className="pipeline-node-detail">{detail}</div>}
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}

export function TracePage() {
  const { selected } = usePatients()
  const [run, setRun] = useState<AgentRun | null>(null)
  const [log, setLog] = useState<AuditLogRow[]>([])
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('all')

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

  const filteredLog = statusFilter === 'all' ? log : log.filter((row) => row.status === statusFilter)

  return (
    <>
      <div className="section-block">
        <span className="eyebrow">
          <Sparkles /> Deterministic, auditable, reproducible
        </span>
        <h1 className="section-title">Agent Trace &amp; Safety</h1>
        <p className="section-lead">
          The "show your work" screen: which agents ran in what order, and how the safety gate
          judged each output. The audit log is append-only.
        </p>
      </div>
      <ErrorNote error={error} />

      <div className="command-bar" style={{ marginBottom: 'var(--space-6)' }}>
        <span className="micro-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PlayCircle size={13} /> Run the full pipeline
        </span>
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
      </div>

      {run && (
        <div className="section-block">
          <span className="micro-label">AI execution map — mode: {run.mode}</span>
          <PipelineFlow trace={run.trace} />
          <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
            Overall safety verdict: <strong>{run.safety.status}</strong> (policy v
            {run.safety.policy_version})
          </p>
        </div>
      )}

      <div className="section-block">
        <span className="micro-label">Safety audit log ({log.length} entries)</span>
        <div className="filter-row">
          <label htmlFor="audit-status-filter" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
            Filter by status
            <select
              id="audit-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_FILTERS)[number])}
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? 'All statuses' : s}
                </option>
              ))}
            </select>
          </label>
          {statusFilter !== 'all' && (
            <span className="muted">
              {filteredLog.length} of {log.length} shown
            </span>
          )}
        </div>
        {filteredLog.length === 0 ? (
          <p className="muted">No audit entries match this filter.</p>
        ) : (
          <div className="table-scroll">
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
                {filteredLog.map((row) => (
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
          </div>
        )}
      </div>

      {policy && (
        <details className="card">
          <summary className="row" style={{ gap: '0.5rem' }}>
            <FileCheck size={15} style={{ color: 'var(--brand)' }} /> Active safety policy
          </summary>
          <div className="details-body">
            <p className="muted" style={{ marginTop: 0 }}>
              Rules are declared in <code>safety_policies.yaml</code> and applied deterministically
              — not judged by an LLM — so the same output always yields the same decision.
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
          </div>
        </details>
      )}
    </>
  )
}
