import type { EvidenceSource } from '../../api/types'
import { EvidenceCitations } from '../EvidenceCitation'

/**
 * Research-style evidence reader for Clinical Analysis. Local and PubMed
 * results stay simultaneously visible (never hidden behind an unclicked
 * tab) — the pill labels are section markers, not a show/hide toggle, so
 * nothing retrieved is ever a click away from being missed. Evidence
 * items keep their true [E#] index (the backend's original retrieval
 * order) even when split into these two groups — see EvidenceCitation.tsx.
 */
export function EvidencePanel({
  includeEvidence,
  includePubmed,
  localEvidence,
  pubmedEvidence,
  total,
}: {
  includeEvidence: boolean
  includePubmed: boolean
  localEvidence: { source: EvidenceSource; index: number }[]
  pubmedEvidence: { source: EvidenceSource; index: number }[]
  total: number
}) {
  if (!includeEvidence && !includePubmed) {
    return <p className="muted">Evidence retrieval was not requested for this analysis.</p>
  }
  if (total === 0) {
    return <p className="muted">No sufficiently relevant evidence was retrieved for this query.</p>
  }
  return (
    <>
      {includePubmed && (
        <div className="evidence-tabs" aria-hidden="true">
          <span className="evidence-tab active">Local ({localEvidence.length})</span>
          <span className="evidence-tab active">PubMed ({pubmedEvidence.length})</span>
        </div>
      )}
      {localEvidence.length > 0 && (
        <>
          <h3 style={{ marginTop: 0 }}>Local evidence</h3>
          <EvidenceCitations items={localEvidence} />
        </>
      )}
      {includePubmed && (
        <>
          <h3>PubMed evidence</h3>
          {pubmedEvidence.length > 0 ? (
            <EvidenceCitations items={pubmedEvidence} />
          ) : (
            <p className="muted" style={{ fontSize: '0.82rem' }}>
              Either no relevant PubMed result was available, or PubMed was unavailable for this
              request. Local evidence above is unaffected.
            </p>
          )}
        </>
      )}
    </>
  )
}
