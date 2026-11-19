import { TrendingDown, TrendingUp } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TimelineEvent } from '../../api/types'
import { CardLabel, chart, color } from '../../design-system'
import { LAB_TEST, LAB_UNIT } from './clinicalModel'
import { DIABETES_LAB_TEST, DIABETES_LAB_UNIT } from './diabetesModel'
import { extractSeries, type TrendPoint } from './trends'

interface MetricDef {
  label: string
  source: 'lab' | 'measurement'
  key: string
  unit?: string
  /** A second, older recording convention to merge in — see
      trends.ts::extractSeries. Weight/BMI predate the lab_result
      convention in the seeded demo history, where they were recorded as
      `weight_kg`/`bmi` measurement keys instead. */
  fallback?: { source: 'lab' | 'measurement'; key: string }
}

/** Every metric the Trends section can chart. Purely a catalog of WHERE
    each value lives in the event log — nothing here invents a metric the
    backend doesn't actually record. */
const METRICS: MetricDef[] = [
  { label: 'Weight', source: 'lab', key: LAB_TEST.WEIGHT, unit: LAB_UNIT[LAB_TEST.WEIGHT], fallback: { source: 'measurement', key: 'weight_kg' } },
  { label: 'BMI', source: 'measurement', key: 'bmi', unit: 'kg/m²' },
  { label: 'Blood pressure — systolic', source: 'lab', key: LAB_TEST.BP_SYSTOLIC, unit: LAB_UNIT[LAB_TEST.BP_SYSTOLIC] },
  { label: 'Blood pressure — diastolic', source: 'lab', key: LAB_TEST.BP_DIASTOLIC, unit: LAB_UNIT[LAB_TEST.BP_DIASTOLIC] },
  { label: 'Heart rate', source: 'lab', key: LAB_TEST.HEART_RATE, unit: LAB_UNIT[LAB_TEST.HEART_RATE] },
  { label: 'HbA1c', source: 'lab', key: DIABETES_LAB_TEST.HBA1C, unit: DIABETES_LAB_UNIT[DIABETES_LAB_TEST.HBA1C] },
  { label: 'Fasting glucose', source: 'lab', key: DIABETES_LAB_TEST.FASTING_GLUCOSE, unit: DIABETES_LAB_UNIT[DIABETES_LAB_TEST.FASTING_GLUCOSE] },
  { label: '2-hour glucose tolerance', source: 'lab', key: DIABETES_LAB_TEST.OGTT, unit: DIABETES_LAB_UNIT[DIABETES_LAB_TEST.OGTT] },
  { label: 'Total cholesterol', source: 'lab', key: 'Total Cholesterol' },
  { label: 'Poor physical-health days', source: 'measurement', key: 'phys_hlth', unit: 'days/30' },
  { label: 'Poor mental-health days', source: 'measurement', key: 'ment_hlth', unit: 'days/30' },
]

function TrendCard({ metric, points }: { metric: MetricDef; points: TrendPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="data-surface rounded-[14px] p-4">
        <p className="text-[0.62rem] font-bold tracking-[0.14em] text-ink-3 uppercase">{metric.label}</p>
        <p className="mt-6 mb-6 text-center text-xs text-ink-3">
          {points.length === 0 ? 'Not enough recorded measurements' : 'Only one recorded measurement — need at least two to chart a trend'}
        </p>
      </div>
    )
  }

  const first = points[0].value
  const last = points[points.length - 1].value
  const delta = last - first
  const improving = metric.key === 'bmi' || metric.key === LAB_TEST.BP_SYSTOLIC || metric.key === LAB_TEST.BP_DIASTOLIC
    || metric.key === 'phys_hlth' || metric.key === 'ment_hlth'
    || metric.key === DIABETES_LAB_TEST.HBA1C || metric.key === DIABETES_LAB_TEST.FASTING_GLUCOSE || metric.key === DIABETES_LAB_TEST.OGTT
    ? delta < 0
    : null // direction isn't inherently "better" for e.g. Weight/Heart rate without more context — no arrow shown

  return (
    <div className="data-surface rounded-[14px] p-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-[0.62rem] font-bold tracking-[0.14em] text-ink-3 uppercase">{metric.label}</p>
        {improving !== null && delta !== 0 && (
          <span className={`flex items-center gap-1 text-[0.66rem] font-semibold ${improving ? 'text-teal' : 'text-rose'}`}>
            {improving ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
            {delta > 0 ? '+' : ''}{Math.round(delta * 10) / 10}
          </span>
        )}
      </div>
      <p className="mb-2 font-mono text-xl font-bold tabular-nums text-ink">
        {last}
        {metric.unit && <span className="ml-1 text-xs font-normal text-ink-3">{metric.unit}</span>}
      </p>
      <div className="h-16">
        <ResponsiveContainer>
          <LineChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              hide
              tickFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            />
            <YAxis hide domain={['dataMin', 'dataMax']} />
            <Tooltip
              contentStyle={chart.tooltip}
              labelFormatter={(d) => new Date(String(d)).toLocaleDateString()}
              formatter={(v) => [`${v}${metric.unit ? ` ${metric.unit}` : ''}`, metric.label]}
            />
            <Line type="monotone" dataKey="value" stroke={color.tealBright} strokeWidth={2} dot={{ r: 2.5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[0.66rem] text-ink-3">
        {points.length} reading{points.length === 1 ? '' : 's'} · latest {new Date(points[points.length - 1].date).toLocaleDateString()}
      </p>
    </div>
  )
}

/**
 * Every chart here is driven by `extractSeries` walking the real event
 * log — a metric with fewer than two recorded points shows the exact
 * "Not enough recorded measurements" empty state rather than a fabricated
 * line. Nothing is interpolated or backfilled.
 */
export function TrendsSection({ events }: { events: TimelineEvent[] }) {
  const withPoints = METRICS.map((m) => ({
    metric: m,
    points: extractSeries(events, m.source, m.key, m.fallback ? [m.fallback] : []),
  }))
  const anyData = withPoints.some((w) => w.points.length >= 2)

  return (
    <div className="mb-10">
      <CardLabel>Trends</CardLabel>
      {!anyData && (
        <p className="mb-4 text-sm text-ink-3">
          Record the same measurement more than once — via "Record vitals, labs & lifestyle" — to see it trended
          here.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {withPoints
          .filter((w) => w.points.length > 0) // a metric never recorded at all doesn't earn a card
          .map(({ metric, points }) => (
            <TrendCard key={metric.key} metric={metric} points={points} />
          ))}
      </div>
    </div>
  )
}
