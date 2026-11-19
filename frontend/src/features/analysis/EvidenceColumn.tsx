import { BookOpen, ChevronDown, ExternalLink, Library } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import type { EvidenceSource } from '../../api/types'
import { CardLabel, Chip, EmptyState, color } from '../../design-system'

export interface IndexedEvidence {
  source: EvidenceSource
  index: number
}

/**
 * One citation card. Only fields the backend actually returns are shown.
 *
 * Note: PubMed authors and publication year are parsed by the backend's
 * PubMed client but dropped before the API response (`rag.py` maps only
 * the journal into `publisher`), so neither can be displayed here without
 * fabricating them.
 */
function EvidenceItem({ index, source, fused }: IndexedEvidence & { fused: boolean }) {
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()
  const isPubmed = source.source_type === 'pubmed'
  const pmid = isPubmed ? source.document_id.split('#')[1] : null

  /*
   * `source.score` means two different things depending on retrieval mode,
   * and rendering it wrong would misrepresent real data rather than just
   * look plain:
   *   - local-only retrieval → cosine similarity, roughly bounded [0.15, 1]
   *     (rag.py ChromaStore.query — MIN_RELEVANCE_SCORE floor, 1 - distance)
   *   - PubMed included → Reciprocal Rank Fusion score, ~1/(60+rank) — a
   *     rank-position value with no meaningful "percent relevant" reading
   *     (rag.py _reciprocal_rank_fusion)
   * `fused` (passed down from whether this analysis requested PubMed) is
   * what lets this component tell the two apart. The bar only renders for
   * the case it can describe honestly; clamped in case the rare keyword-
   * fallback store (no chromadb/embeddings available) returns >1.
   */
  const showMatch = !fused && typeof source.score === 'number'
  const matchPct = showMatch ? Math.round(Math.min(1, Math.max(0, source.score)) * 100) : null

  return (
    <li
      id={`E${index}`}
      className={`overflow-hidden rounded-[14px] border transition-colors ${
        open ? 'border-teal/40 bg-subtle' : 'border-border-strong bg-surface hover:border-ink-3'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-3.5 py-3 text-left"
      >
        <span className="mt-px flex shrink-0 items-center gap-1 rounded border border-teal/35 bg-teal/10 px-1.5 py-0.5 font-mono text-[0.64rem] font-bold text-teal">
          {isPubmed ? <Library size={10} aria-hidden="true" /> : <BookOpen size={10} aria-hidden="true" />}
          E{index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug font-medium text-ink">{source.title}</span>
          <span className="mt-0.5 block truncate text-[0.7rem] text-ink-3">{source.publisher}</span>
          {showMatch && matchPct !== null && (
            <span className="mt-1.5 flex items-center gap-2" role="img" aria-label={`Match strength ${matchPct}%`}>
              <span className="h-1 w-14 overflow-hidden rounded-full bg-[#eef2f7]">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${matchPct}%`, background: color.tealBright }}
                />
              </span>
              <span className="font-mono text-[0.62rem] text-ink-3">{matchPct}% match</span>
            </span>
          )}
        </span>
        <ChevronDown
          size={14}
          className={`mt-1 shrink-0 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="border-t border-border-strong px-3.5 py-3">
              <blockquote className="mb-3 border-l-2 border-teal/40 pl-3 text-xs leading-relaxed text-ink-2">
                {source.text.slice(0, 340)}
                {source.text.length > 340 ? '…' : ''}
              </blockquote>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[0.7rem]">
                {source.section && (
                  <>
                    <dt className="text-ink-3">Section</dt>
                    <dd className="text-ink-2">{source.section}</dd>
                  </>
                )}
                {pmid && (
                  <>
                    <dt className="text-ink-3">PMID</dt>
                    <dd className="font-mono text-ink-2">{pmid}</dd>
                  </>
                )}
                {source.doi && (
                  <>
                    <dt className="text-ink-3">DOI</dt>
                    <dd className="font-mono break-all text-ink-2">{source.doi}</dd>
                  </>
                )}
                {source.accessed && (
                  <>
                    <dt className="text-ink-3">Accessed</dt>
                    <dd className="text-ink-2">{source.accessed}</dd>
                  </>
                )}
              </dl>
              {source.source_url && (
                <a
                  href={source.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-[0.7rem] text-teal hover:underline"
                >
                  Open citation <ExternalLink size={10} />
                </a>
              )}
              {source.license?.toLowerCase().includes('copyright') && source.attribution && (
                <p className="mt-2 text-[0.66rem] leading-relaxed text-ink-3 italic">{source.attribution}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

export function EvidenceColumn({
  local,
  pubmed,
  requested,
  fused,
}: {
  local: IndexedEvidence[]
  pubmed: IndexedEvidence[]
  requested: boolean
  /** Whether THIS analysis's request included PubMed — not live UI state,
      which may have changed since the request that produced this result. */
  fused: boolean
}) {
  const all = [...local, ...pubmed].sort((a, b) => a.index - b.index)

  return (
    <section aria-labelledby="evidence-col">
      <CardLabel>
        <span id="evidence-col">Grounded evidence</span>
      </CardLabel>

      {!requested ? (
        <p className="text-sm text-ink-3">Evidence retrieval was not requested for this analysis.</p>
      ) : all.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No evidence retrieved"
          reason="No sufficiently relevant passage was returned for this question."
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <Chip tone="teal">{local.length} local</Chip>
            {pubmed.length > 0 && <Chip tone="blue">{pubmed.length} PubMed</Chip>}
          </div>
          <ul className="flex flex-col gap-2">
            {all.map((item) => (
              <EvidenceItem key={item.source.document_id || item.index} {...item} fused={fused} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
