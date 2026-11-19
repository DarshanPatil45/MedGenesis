import { useEffect, useMemo, useState } from 'react'
import {
  Brush,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import type { TimelineEvent } from '../../api/types'
import { chart, color, eventColor } from '../../design-system'

export const LANE_LABEL: Record<string, string> = {
  measurement: 'Events',
  lab_result: 'Labs',
  medication_change: 'Meds',
  lifestyle_log: 'Lifestyle',
  screening: 'Screening',
  care_plan: 'Care plan',
  note: 'Notes',
}

export interface LanePoint {
  x: number
  y: string
  event: TimelineEvent
}

function summarize(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload)
  if (!entries.length) return '—'
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
}

function PointTooltip({ active, payload }: { active?: boolean; payload?: { payload: LanePoint }[] }) {
  if (!active || !payload?.length) return null
  const { event } = payload[0].payload
  return (
    <div style={chart.tooltip} className="max-w-xs px-3 py-2">
      <p className="font-mono text-[0.66rem] text-teal">
        {new Date(event.recorded_at).toLocaleDateString()} · {event.event_type}
      </p>
      <p className="mt-1 text-xs break-words text-ink-2">{summarize(event.payload)}</p>
      <p className="mt-1 text-[0.62rem] text-ink-3">Click to open the full record</p>
    </div>
  )
}

/**
 * Longitudinal canvas: one lane per real `event_type`, positioned by the
 * event's true `recorded_at`. Brush below the plot zooms the date range.
 * Clicking a point raises the full record to the caller's drawer.
 */
export function TimelineCanvas({
  events,
  onSelect,
}: {
  events: TimelineEvent[]
  onSelect: (event: TimelineEvent) => void
}) {
  const { lanes, points, domain, pad } = useMemo(() => {
    const laneKeys = [...new Set(events.map((e) => e.event_type))]
    // Sorted by time: <Brush> reports positions as indices into this array,
    // so the order has to be chronological for a brushed range to mean one.
    const pts: LanePoint[] = events
      .map((e) => ({
        x: new Date(e.recorded_at).getTime(),
        y: LANE_LABEL[e.event_type] ?? e.event_type,
        event: e,
      }))
      .sort((a, b) => a.x - b.x)
    const times = pts.map((p) => p.x)
    const min = times.length ? Math.min(...times) : 0
    const max = times.length ? Math.max(...times) : 1
    const p = Math.max((max - min) * 0.04, 86_400_000)
    return { lanes: laneKeys, points: pts, domain: [min - p, max + p] as [number, number], pad: p }
  }, [events])

  /*
   * The brushed window, as indices into `points`.
   *
   * <Brush> only reports its position — it does not move the axis. With
   * `domain` pinned to the full range the handles dragged but nothing
   * happened, so the zoom the caption advertises has to be applied here.
   */
  const [window_, setWindow] = useState<[number, number] | null>(null)

  // Filters and patient switches reshape `points`; stale indices would
  // otherwise zoom to an unrelated slice.
  useEffect(() => setWindow(null), [points])

  const xDomain = useMemo<[number, number]>(() => {
    if (!window_ || points.length === 0) return domain
    const [a, z] = window_
    const lo = points[Math.max(0, Math.min(a, points.length - 1))]?.x
    const hi = points[Math.max(0, Math.min(z, points.length - 1))]?.x
    if (lo === undefined || hi === undefined || lo === hi) return domain
    return [lo - pad, hi + pad]
  }, [window_, points, domain, pad])

  const laneNames = lanes.map((k) => LANE_LABEL[k] ?? k)

  return (
    <div className="h-[26rem] w-full">
      <ResponsiveContainer>
        {/*
          `data` on the chart root is what <Brush> reads from. Each <Scatter>
          supplies its own lane slice for rendering, but without this the
          Brush has no series to range over and silently renders nothing —
          while the caption below still promised it.
        */}
        <ScatterChart data={points} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
          {/* Vertical rules only. Horizontal ones fight the lane bands
              below, and the y scale is categorical — a gridline between
              two category names measures nothing. */}
          <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" horizontal={false} />

          {/*
            Swimlane banding. With events this sparse, unbanded lanes read as
            dots floating on white; a tint per lane makes each row legible as
            a track and ties the y label to its points.
          */}
          {laneNames.map((name, i) =>
            i % 2 === 0 ? (
              <ReferenceArea
                key={name}
                y1={name}
                y2={name}
                ifOverflow="extendDomain"
                fill={color.subtle}
                fillOpacity={1}
                stroke="none"
              />
            ) : null,
          )}
          <XAxis
            type="number"
            dataKey="x"
            domain={xDomain}
            // Required for the brush to zoom. Recharts defaults this to
            // false, which widens the domain back out until every point
            // fits — so the axis silently ignored the brushed range.
            allowDataOverflow
            scale="time"
            tickFormatter={(v: number) => new Date(v).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}
            stroke={chart.axis}
            fontSize={11}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="y"
            allowDuplicatedCategory={false}
            ticks={laneNames}
            width={78}
            stroke={chart.axis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <ZAxis range={[90, 90]} />
          <Tooltip content={<PointTooltip />} cursor={{ stroke: chart.grid }} />
          {lanes.map((key) => (
            <Scatter
              key={key}
              name={LANE_LABEL[key] ?? key}
              data={points.filter((p) => p.event.event_type === key)}
              fill={eventColor[key] ?? chart.axis}
              onClick={(p: unknown) => {
                const point = p as { payload?: LanePoint }
                if (point?.payload?.event) onSelect(point.payload.event)
              }}
              className="cursor-pointer"
            />
          ))}
          <Brush
            dataKey="x"
            height={26}
            travellerWidth={8}
            // Was #0d1117 — a leftover from the dark theme, which rendered as
            // a near-black slab under a white chart. It needs enough contrast
            // to look draggable: `subtle` alone disappears against the card.
            stroke={color.borderStrong}
            fill={color.subtle}
            onChange={(r: { startIndex?: number; endIndex?: number }) => {
              if (typeof r.startIndex === 'number' && typeof r.endIndex === 'number') {
                setWindow(r.startIndex === 0 && r.endIndex === points.length - 1 ? null : [r.startIndex, r.endIndex])
              }
            }}
            tickFormatter={(v: number) => new Date(v).toLocaleDateString(undefined, { month: 'short' })}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
