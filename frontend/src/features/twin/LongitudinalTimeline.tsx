import { ArrowRight } from 'lucide-react'
import type { TimelineEvent } from '../../api/types'
import { CardLabel, EmptyState, color, eventColor } from '../../design-system'
import { Waypoints } from 'lucide-react'
import { buildTimelineEntries } from './timelineDiff'

/**
 * The readable "Sep 09 · Weight updated · 82.4 kg → 81.7 kg" timeline —
 * built entirely by `buildTimelineEntries` walking the real event log.
 * This is the same event data the Longitudinal Canvas / Recent Activity
 * list below (in the Advanced section) render as a scatter plot; this is
 * just the human-readable version, foregrounded because most people read
 * "what changed and when" faster as sentences than as a chart.
 */
export function LongitudinalTimeline({ events }: { events: TimelineEvent[] }) {
  const entries = buildTimelineEntries(events).slice(0, 20)

  if (entries.length === 0) {
    return (
      <div className="mb-10">
        <CardLabel>Longitudinal timeline</CardLabel>
        <EmptyState
          icon={Waypoints}
          title="No events recorded"
          reason="Every edit, measurement and recommendation will appear here, in order, once recorded."
        />
      </div>
    )
  }

  return (
    <div className="mb-10">
      <CardLabel>Longitudinal timeline</CardLabel>
      <ol className="data-surface divide-y divide-border rounded-[14px]">
        {entries.map((entry) => (
          <li key={entry.id} className="flex gap-4 px-4 py-3.5 sm:px-5">
            <span
              aria-hidden="true"
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
              style={{ background: eventColor[entry.eventType] ?? color.ink3 }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[0.66rem] font-semibold tracking-wide text-ink-3 uppercase">
                {new Date(entry.recordedAt).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })}
              </p>
              {entry.summary && !entry.changes.length ? (
                <p className="mt-0.5 text-sm text-ink">{entry.summary}</p>
              ) : (
                <ul className="mt-0.5 space-y-1">
                  {entry.changes.map((c, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-x-2 text-sm">
                      <span className="font-medium text-ink">{c.label}</span>
                      {c.to !== '' && (
                        <span className="flex items-center gap-1.5 text-ink-2">
                          {c.from && (
                            <>
                              <span className="text-ink-3 line-through">{c.from}</span>
                              <ArrowRight size={11} className="text-ink-3" aria-hidden="true" />
                            </>
                          )}
                          <span className={c.from ? 'font-medium text-teal' : 'font-medium text-ink'}>{c.to}</span>
                          {!c.from && <span className="text-[0.66rem] text-ink-3">(first recorded)</span>}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
