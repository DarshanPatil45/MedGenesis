import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
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
  const reduceMotion = useReducedMotion()
  // pubmed#<pmid> is the document_id convention (app/services/rag.py) —
  // never fabricated if the source isn't actually from PubMed.
  const pmid = source.source_type === 'pubmed' ? source.document_id.split('#')[1] : null

  return (
    <div id={`E${index}`} className="card evidence-card">
      <button
        className="secondary evidence-card-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="evidence-chip evidence-chip-static">E{index}</span>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <span className="evidence-card-title">
            {source.title} <span className="muted">— {source.publisher}</span>
          </span>
          {!open && (
            <span className="evidence-card-preview muted">
              {source.text.slice(0, 140)}
              {source.text.length > 140 ? '…' : ''}
            </span>
          )}
        </span>
        <ChevronDown size={16} className={`evidence-card-caret${open ? ' open' : ''}`} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <dl className="kv" style={{ fontSize: '0.84rem' }}>
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
