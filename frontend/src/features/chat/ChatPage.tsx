import { ExternalLink, MessageSquare, Send, Sparkles, UserRound } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { ChatResponse, EvidenceSource, Safety } from '../../api/types'
import {
  Button,
  CardLabel,
  Chip,
  ChipButton,
  Drawer,
  EmptyState,
  ErrorState,
  StageHeader,
} from '../../design-system'
import { PageContainer } from '../../layouts/AppShell'
import { usePatients } from '../../PatientContext'
import { SafetyGate } from '../safety/SafetyGate'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  safety?: Safety
  response?: ChatResponse
}

/** Contextual starters — questions about lifestyle topics the agent is scoped to. */
const STARTERS = [
  'How much exercise should I do each week?',
  'What should I eat to help manage blood sugar?',
  'How does losing weight affect diabetes risk?',
  'Why is sleep relevant to blood sugar?',
]

export function ChatPage() {
  const { selected } = usePatients()
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<EvidenceSource | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = logRef.current
    // `Element.scrollTo` is not implemented in jsdom, and is missing in
    // some older browsers — fall back to assigning scrollTop.
    if (!el) return
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
  }, [turns, busy, reduced])

  // A session belongs to one patient; switching patients starts fresh.
  useEffect(() => {
    setTurns([])
    setSessionId(null)
  }, [selected?.id])

  const send = async (text: string) => {
    if (!selected || !text.trim() || busy) return
    setTurns((t) => [...t, { role: 'user', content: text }])
    setInput('')
    setBusy(true)
    setError(null)
    try {
      const resp = await api.chat(selected.id, text, sessionId)
      setSessionId(resp.session_id)
      setTurns((t) => [...t, { role: 'assistant', content: resp.reply_text, safety: resp.safety, response: resp }])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!selected) {
    return (
      <PageContainer className="py-16">
        <EmptyState
          icon={UserRound}
          title="No patient selected"
          reason="The assistant is anchored to one patient's record."
          action={<Chip tone="teal">Choose a patient from the chip in the top bar</Chip>}
        />
      </PageContainer>
    )
  }

  const last = [...turns].reverse().find((t) => t.role === 'assistant')

  return (
    <>
      <section className="border-b border-border-strong">
        <PageContainer className="py-12 lg:py-14">
          <StageHeader
            eyebrow="Assistant"
            eyebrowIcon={MessageSquare}
            title="Assistant"
            subtitle={`Anchored to patient #${selected.id}. Scoped to lifestyle and education topics and grounded in cited sources — every reply passes the safety gate before it is shown. Responses are clinical decision-support information, not medical advice.`}
          />
        </PageContainer>
      </section>

      <PageContainer className="py-8 lg:py-10">
        <ErrorState error={error} />

        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <div className="data-surface flex h-[62vh] min-h-[26rem] flex-col overflow-hidden rounded-[14px]">
              <div ref={logRef} className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
                {turns.length === 0 && (
                  <div className="m-auto max-w-md">
                    <EmptyState
                      icon={Sparkles}
                      title={`Ask about ${selected.pseudonym}`}
                      reason="Try one of the starters below, or type your own lifestyle or education question."
                    />
                  </div>
                )}

                {turns.map((t, i) => (
                  <motion.div
                    key={i}
                    initial={reduced ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24 }}
                    className={`flex max-w-[86%] flex-col ${t.role === 'user' ? 'items-end self-end' : 'items-start self-start'}`}
                  >
                    <span className="mb-1.5 text-[0.58rem] font-bold tracking-[0.18em] text-ink-3 uppercase">
                      {t.role === 'user' ? 'You' : 'MedGenesis'}
                    </span>
                    <div
                      className={`rounded-[14px] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                        t.role === 'user'
                          ? 'rounded-tr-sm bg-teal/12 text-ink ring-1 ring-teal/25'
                          : 'rounded-tl-sm border border-border-strong bg-subtle text-ink'
                      }`}
                    >
                      {t.content}
                    </div>

                    {/* Inline evidence pills — open the real source in a drawer. */}
                    {t.role === 'assistant' && t.response && t.response.sources.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {t.response.sources.map((s, si) => (
                          <button
                            key={si}
                            onClick={() => setSource(s)}
                            className="rounded border border-teal/30 bg-teal/10 px-1.5 py-px font-mono text-[0.64rem] font-bold text-teal transition-colors hover:bg-teal/20"
                            aria-label={`Open source E${si + 1}: ${s.title}`}
                          >
                            E{si + 1}
                          </button>
                        ))}
                      </div>
                    )}
                  </motion.div>
                ))}

                {busy && (
                  <div className="flex items-center gap-2 self-start text-sm text-ink-3" role="status">
                    <span className="flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </span>
                    Retrieving and composing a grounded reply…
                  </div>
                )}
              </div>

              <div className="border-t border-border-strong p-4">
                <div className="flex gap-2">
                  <label htmlFor="chat-input" className="sr-only">Message</label>
                  <input
                    id="chat-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void send(input)}
                    placeholder="Ask about diet, activity, monitoring…"
                    className="flex-1 rounded-[10px] border border-border-strong bg-surface px-4 py-2.5 text-sm text-ink placeholder:text-ink-3 focus-visible:border-teal"
                  />
                  <Button variant="primary" onClick={() => void send(input)} disabled={busy || !input.trim()} aria-label="Send message">
                    <Send size={15} />
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {STARTERS.map((s) => (
                    <ChipButton key={s} onClick={() => void send(s)} disabled={busy}>
                      {s}
                    </ChipButton>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-4">
            {last?.safety ? (
              <>
                <CardLabel>Last reply</CardLabel>
                <SafetyGate safety={last.safety} className="mb-4" />
                {last.response && (
                  <p className="text-xs leading-relaxed text-ink-3">
                    Generated by <code className="font-mono text-ink-2">{last.response.generated_by}</code> · tools:{' '}
                    {last.response.tools_used.join(', ') || 'none'}
                  </p>
                )}
              </>
            ) : (
              <>
                <CardLabel>Safety</CardLabel>
                <p className="text-sm leading-relaxed text-ink-3">
                  Every assistant reply is reviewed by the safety gate before display. The verdict for the most recent
                  reply appears here.
                </p>
              </>
            )}
          </div>
        </div>
      </PageContainer>

      {/* Source drawer */}
      <Drawer
        open={!!source}
        onOpenChange={(o) => !o && setSource(null)}
        title={source?.title ?? ''}
        description={source?.publisher}
      >
        {source && (
          <>
            <blockquote className="mb-5 border-l-2 border-teal/40 pl-4 text-sm leading-relaxed text-ink-2">
              {source.text}
            </blockquote>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2 text-xs">
              {source.section && (<><dt className="text-ink-3">Section</dt><dd className="text-ink-2">{source.section}</dd></>)}
              <dt className="text-ink-3">Document</dt>
              <dd className="font-mono break-all text-ink-2">{source.document_id}</dd>
              {source.doi && (<><dt className="text-ink-3">DOI</dt><dd className="font-mono break-all text-ink-2">{source.doi}</dd></>)}
              {source.accessed && (<><dt className="text-ink-3">Accessed</dt><dd className="text-ink-2">{source.accessed}</dd></>)}
            </dl>
            {source.source_url && (
              <a href={source.source_url} target="_blank" rel="noreferrer"
                className="mt-5 inline-flex items-center gap-1.5 text-sm text-teal hover:underline">
                Open source <ExternalLink size={12} />
              </a>
            )}
            {source.license?.toLowerCase().includes('copyright') && source.attribution && (
              <p className="mt-4 text-xs leading-relaxed text-ink-3 italic">{source.attribution}</p>
            )}
          </>
        )}
      </Drawer>
    </>
  )
}
