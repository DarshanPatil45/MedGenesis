import { useState } from 'react'
import type { EvidenceSource } from '../api/types'

/**
 * Numbered, expandable citation cards for the Clinical Analysis page —
 * distinct from components/common.tsx's `Sources` (a flat always-open
 * list used by Care Plan/Chat) because Clinical Analysis findings are
 * numbered [E1]/[E2]... and referenced by ID elsewhere on the page, so
 * each one needs an anchor a reader can expand on demand. Reuses the same
 * `EvidenceSource` type — no second evidence shape.
 *
 * Takes `index` explicitly (1-based, matching the backend's own [E#]
 * numbering — the order evidence was originally retrieved in, which is
 * also what `evidence_ids`/`citations` elsewhere reference) rather than
 * deriving it from array position, so a caller can group/filter the list
 * for display (e.g. Local vs PubMed) without renumbering anything.
 */
export function EvidenceCitations({ items }: { items: { source: EvidenceSource; index: number }[] }) {
  if (!items?.length) return null
  return (
    <div>
      {items.map(({ source, index }) => (
        <EvidenceCitationCard key={source.document_id || index} index={index} source={source} />
      ))}
    </div>
  )
}

function EvidenceCitationCard({ index, source }: { index: number; source: EvidenceSource }) {
  const [open, setOpen] = useState(false)
  // pubmed#<pmid> is the document_id convention (app/services/rag.py) —
  // never fabricated if the source isn't actually from PubMed.
  const pmid = source.source_type === 'pubmed' ? source.document_id.split('#')[1] : null

  return (
    <div id={`E${index}`} className="card" style={{ marginBottom: '0.6rem', padding: '0.7rem 0.9rem' }}>
      <button
        className="secondary"
        onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', textAlign: 'left' }}
        aria-expanded={open}
      >
        [E{index}] {source.title} — {source.publisher} {open ? '▾' : '▸'}
      </button>
      {open && (
        <dl className="kv" style={{ marginTop: '0.6rem', fontSize: '0.84rem' }}>
          <dt>Title</dt>
          <dd>{source.title}</dd>
          <dt>Source</dt>
          <dd>{source.publisher}</dd>
          <dt>Document ID</dt>
          <dd>
            <code>{source.document_id}</code>
          </dd>
          {/* Every field below is rendered only when the backend actually
              supplied it — never a placeholder for a missing PMID/DOI. */}
          {pmid && (
            <>
              <dt>PMID</dt>
              <dd>{pmid}</dd>
            </>
          )}
          {source.doi && (
            <>
              <dt>DOI</dt>
              <dd>{source.doi}</dd>
            </>
          )}
          {source.source_url && (
            <>
              <dt>URL</dt>
              <dd>
                <a href={source.source_url} target="_blank" rel="noreferrer">
                  {source.source_url}
                </a>
              </dd>
            </>
          )}
          {source.accessed && (
            <>
              <dt>Accessed</dt>
              <dd>{source.accessed}</dd>
            </>
          )}
          <dt>Excerpt</dt>
          <dd className="muted">
            {source.text.slice(0, 300)}
            {source.text.length > 300 ? '…' : ''}
          </dd>
          {source.license?.toLowerCase().includes('copyright') && source.attribution && (
            <>
              <dt>Attribution</dt>
              <dd className="muted" style={{ fontStyle: 'italic' }}>
                {source.attribution}
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  )
}
