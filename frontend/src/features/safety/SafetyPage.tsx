import { ArrowRight, ChevronLeft, ChevronRight, FileCheck, ShieldCheck, Workflow } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { AuditLogRow } from '../../api/types'
import {
  Card,
  CardLabel,
  Chip,
  ChipButton,
  EmptyState,
  ErrorState,
  SAFETY_DISCLAIMER,
  StageHeader,
  Stat,
  TableSkeleton,
  type ChipTone,
} from '../../design-system'
import { PageContainer } from '../../layouts/AppShell'

/**
 * Severity ordering is the backend's own `SafetyOut.status` enum — the
 * three values the policy layer can return. Nothing is added.
 */
const SEVERITY: { status: string; label: string; tone: ChipTone }[] = [
  { status: 'BLOCKED', label: 'Blocked', tone: 'rose' },
  { status: 'FLAGGED_FOR_CLINICIAN_REVIEW', label: 'Flagged for review', tone: 'amber' },
  { status: 'APPROVED', label: 'Approved', tone: 'teal' },
]

const TONE_FOR: Record<string, ChipTone> = {
  BLOCKED: 'rose',
  FLAGGED_FOR_CLINICIAN_REVIEW: 'amber',
  APPROVED: 'teal',
}

// The audit log is fetched complete (append-only, already capped by the
// API's own limit param) — this paginates the already-fetched rows on
// the client so the page itself doesn't become an 11,000px scroll of
// near-identical "APPROVED" rows before the reader ever reaches Active
// Policy or Advanced.
const PAGE_SIZE = 25

export function SafetyPage() {
  const [log, setLog] = useState<AuditLogRow[]>([])
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [page, setPage] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setLog(await api.auditLog())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
    api.safetyPolicy().then(setPolicy).catch(() => setPolicy(null))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(
    () => SEVERITY.map((s) => ({ ...s, n: log.filter((r) => r.status === s.status).length })),
    [log],
  )

  const rows = filter === 'all' ? log : log.filter((r) => r.status === filter)
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount - 1)
  const pageRows = rows.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE)

  const setFilterAndResetPage = (f: string) => {
    setFilter(f)
    setPage(0)
  }

  return (
    <>
      <section className="border-b border-border-strong">
        <PageContainer className="py-12 lg:py-14">
          <StageHeader
            eyebrow="Safety"
            eyebrowIcon={ShieldCheck}
            title="Safety"
            subtitle="Every clinically-sensitive output — screening, simulation, care plan, chat and assessment — passes through a deterministic policy layer before it is shown. The audit log below is append-only and complete."
            metrics={
              !loading && log.length > 0 ? (
                <>
                  <Stat label="Total reviews" value={String(log.length)} />
                  {counts.map((c) => (
                    <Stat key={c.status} label={c.label} value={String(c.n)} />
                  ))}
                </>
              ) : undefined
            }
          />
        </PageContainer>
      </section>

      <PageContainer className="py-10 lg:py-12">
        <ErrorState error={error} onRetry={load} />

        {/* Legal / educational block — institutional, not cinematic. */}
        <Card layer="data" pad="md" className="mb-10 border-amber/25">
          <div className="flex items-start gap-3">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-amber" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-ink">{SAFETY_DISCLAIMER}</p>
              <p className="mt-2 text-xs leading-relaxed text-ink-2">
                MedGenesis is an educational research prototype. It is not a medical device, has not been clinically
                validated, and must not be used to make care decisions. All patient records in this system are
                synthetic.
              </p>
            </div>
          </div>
        </Card>

        <section className="mb-10">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <CardLabel className="mb-0">Audit log · {log.length} entries</CardLabel>
            <div className="flex flex-wrap gap-2">
              <ChipButton selected={filter === 'all'} onClick={() => setFilterAndResetPage('all')}>
                All
              </ChipButton>
              {counts.map((c) => (
                <ChipButton key={c.status} tone={c.tone} selected={filter === c.status} onClick={() => setFilterAndResetPage(c.status)}>
                  {c.label} · {c.n}
                </ChipButton>
              ))}
            </div>
          </div>

          {loading ? (
            <TableSkeleton rows={8} cols={6} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title={log.length === 0 ? 'No safety reviews recorded yet' : 'No entries match this filter'}
              reason={
                log.length === 0
                  ? 'Run a screening, analysis, care plan or chat request to generate a reviewed output.'
                  : undefined
              }
            />
          ) : (
            <Card layer="data" pad="none" className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Append-only safety audit log</caption>
                <thead>
                  <tr className="border-b border-border-strong">
                    {['ID', 'Reviewed at', 'Target', 'Verdict', 'Reasons', 'Policy'].map((h) => (
                      <th key={h} scope="col" className="px-4 py-3 text-[0.6rem] font-bold tracking-[0.14em] text-ink-3 uppercase">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.id} className="border-b border-border-strong/60 align-top last:border-0 hover:bg-subtle/50">
                      <td className="px-4 py-2.5 font-mono text-xs text-ink-3">{r.id}</td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap text-ink-2">
                        {new Date(r.reviewed_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-2">
                        {r.target_type} #{r.target_id}
                      </td>
                      <td className="px-4 py-2.5">
                        <Chip tone={TONE_FOR[r.status] ?? 'neutral'}>{r.status}</Chip>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-2">
                        {r.reasons.length ? (
                          <ul className="space-y-1">
                            {r.reasons.map((reason, i) => (
                              <li key={i}>{reason}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-ink-3">v{r.policy_version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pageCount > 1 && (
                <div className="flex items-center justify-between border-t border-border-strong px-4 py-2.5 text-xs text-ink-3">
                  <span>
                    {clampedPage * PAGE_SIZE + 1}–{Math.min(rows.length, (clampedPage + 1) * PAGE_SIZE)} of {rows.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={clampedPage === 0}
                      aria-label="Previous page"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="font-mono tabular-nums">{clampedPage + 1} / {pageCount}</span>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={clampedPage >= pageCount - 1}
                      aria-label="Next page"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </section>

        {policy && (
          <section>
            <CardLabel>Active policy</CardLabel>
            <Card layer="data" pad="md">
              <p className="mb-4 max-w-3xl text-xs leading-relaxed text-ink-2">
                Rules are declared in <code className="font-mono text-ink-3">safety_policies.yaml</code> and applied
                deterministically — not judged by a language model — so the same output always yields the same verdict.
              </p>
              <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-[max-content_1fr]">
                <dt className="flex items-center gap-1.5 text-xs text-ink-3">
                  <FileCheck size={12} /> Policy version
                </dt>
                <dd className="font-mono text-sm text-ink">{String(policy.policy_version)}</dd>
                <dt className="text-xs text-ink-3">Blocking rules</dt>
                <dd className="text-sm text-ink-2">
                  {(policy.blocked_rules as { id: string; pattern_count: number }[] | undefined)?.map((r) => (
                    <span key={r.id} className="mr-2 inline-block">
                      {r.id} <span className="text-ink-3">({r.pattern_count})</span>
                    </span>
                  )) ?? '—'}
                </dd>
                <dt className="text-xs text-ink-3">Disclaimer required for</dt>
                <dd className="text-sm text-ink-2">
                  {(policy.disclaimer_required_for as string[] | undefined)?.join(', ') ?? '—'}
                </dd>
              </dl>
            </Card>
          </section>
        )}

        <details className="data-surface mt-10 rounded-[14px]">
          <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-ink">Advanced</summary>
          <div className="border-t border-border-strong px-5 py-4">
            <Link
              to="/trace"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-teal hover:underline"
            >
              <Workflow size={14} /> Agent trace <ArrowRight size={13} />
            </Link>
            <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-ink-3">
              Step-by-step execution log for the agents behind a screening, simulation, care plan or assessment
              request — for auditing, not needed for everyday use.
            </p>
          </div>
        </details>
      </PageContainer>
    </>
  )
}
