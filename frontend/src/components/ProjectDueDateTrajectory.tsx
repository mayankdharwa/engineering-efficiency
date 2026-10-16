import { defineChart, dot, link, text } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react/tooltip'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { useTimezone } from '../hooks/useAppSettings'
import { formatCalendarDate, formatDateTime } from '../lib/format'
import { projectStateKey } from '../lib/projectState'
import type { ProjectDueDateChangeOut, ProjectOut } from '../types'

const COLOR_OPEN_FILL = 'var(--card)'
const COLOR_OPEN_STROKE = 'var(--foreground)'
/** Same emerald as the completed tone in the projects table. */
const COLOR_PLAN = 'var(--trajectory-plan)'
/** Same amber as the warning tone in the projects table. */
const COLOR_SHIFT = 'var(--trajectory-shift)'
/** Same emerald as the completed check in the projects table. */
const COLOR_COMPLETE = 'var(--trajectory-complete)'
const CHECK_OFFSET = 16
const MS_PER_DAY = 86_400_000
const NAME_MAX = 28

interface ChartDatum {
  key: string
  name: string
  label: string
  chain: string
}

interface DateStop extends ChartDatum {
  at: number
  date: string
  role: 'start' | 'first' | 'middle' | 'current' | 'check'
  index: number
  count: number
  changedAt: string | null
  step: string
}

interface Segment extends ChartDatum {
  id: string
  x1: number
  x2: number
  kind: 'plan' | 'shift'
  fromLabel: string
  toLabel: string
  movement: string
}

function calendarMs(value: string | null): number | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!match) return null
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function dateTick(value: unknown): string {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return formatCalendarDate(`${date.getUTCFullYear()}-${month}-${day}`)
}

function movementLabel(start: number, end: number): string {
  const days = Math.round((end - start) / MS_PER_DAY)
  if (days === 0) return 'Unchanged'
  const count = Math.abs(days)
  const unit = count === 1 ? 'day' : 'days'
  return days > 0 ? `${count} ${unit} later` : `${count} ${unit} earlier`
}

function spanLabel(start: number, end: number): string {
  const count = Math.abs(Math.round((end - start) / MS_PER_DAY))
  if (count === 0) return 'Same day'
  return count === 1 ? '1 day' : `${count} days`
}

function axisLabel(name: string): string {
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX)}…` : name
}

function chartHeight(count: number): number {
  return Math.max(160, count * 36 + 56)
}

/** Every due date the project has been given, in the order they were set. */
function dueDates(history: ProjectDueDateChangeOut[]): { date: string; changedAt: string | null }[] {
  const dates: { date: string; changedAt: string | null }[] = []
  for (const change of history) {
    if (dates.length === 0 && change.from_date) {
      dates.push({ date: change.from_date, changedAt: null })
    }
    if (!change.to_date) continue
    const last = dates[dates.length - 1]
    if (last?.date === change.to_date) continue
    dates.push({ date: change.to_date, changedAt: change.changed_at })
  }
  return dates
}

function trajectoryFor(
  project: ProjectOut,
): { stops: DateStop[]; segments: Segment[]; checks: DateStop[] } | null {
  const dates = dueDates(project.due_date_history)
  const dueStops = dates.flatMap((item) => {
    const at = calendarMs(item.date)
    return at === null ? [] : [{ ...item, at }]
  })
  if (dueStops.length === 0) return null

  const startAt = calendarMs(project.start_date)
  const startDate = startAt === null ? null : project.start_date
  const dueLabels = dueStops.map((stop) => formatCalendarDate(stop.date))
  const startLabel = startDate ? formatCalendarDate(startDate) : null
  const chain =
    startLabel && startLabel !== dueLabels[0] ? [startLabel, ...dueLabels].join(' → ') : dueLabels.join(' → ')
  const shared = {
    key: String(project.id),
    name: project.name,
    label: axisLabel(project.name),
    chain,
  }
  const count = dueStops.length
  const stops: DateStop[] = dueStops.map((stop, index) => {
    const previous = index === 0 ? null : dueStops[index - 1]?.at
    const role = count === 1 ? 'current' : index === 0 ? 'first' : index === count - 1 ? 'current' : 'middle'
    return {
      ...shared,
      at: stop.at,
      date: stop.date,
      role,
      index: index + 1,
      count,
      changedAt: stop.changedAt,
      step: previous === null || previous === undefined ? 'First due date' : movementLabel(previous, stop.at),
    }
  })
  if (startAt !== null && startDate && !dueStops.some((stop) => stop.at === startAt)) {
    stops.unshift({
      ...shared,
      at: startAt,
      date: startDate,
      role: 'start',
      index: 0,
      count,
      changedAt: null,
      step: 'Start date',
    })
  }

  const segments: Segment[] = []
  const first = dueStops[0]
  if (startAt !== null && startDate && first && startAt !== first.at) {
    segments.push({
      ...shared,
      id: `${shared.key}:plan`,
      x1: startAt,
      x2: first.at,
      kind: 'plan',
      fromLabel: formatCalendarDate(startDate),
      toLabel: formatCalendarDate(first.date),
      movement: spanLabel(startAt, first.at),
    })
  }
  for (let index = 1; index < dueStops.length; index += 1) {
    const previous = dueStops[index - 1]
    const next = dueStops[index]
    if (!previous || !next || previous.at === next.at) continue
    segments.push({
      ...shared,
      id: `${shared.key}:shift:${index}`,
      x1: previous.at,
      x2: next.at,
      kind: 'shift',
      fromLabel: formatCalendarDate(previous.date),
      toLabel: formatCalendarDate(next.date),
      movement: movementLabel(previous.at, next.at),
    })
  }

  const current = stops.find((stop) => stop.role === 'current')
  const checks: DateStop[] =
    current && projectStateKey(project.state) === 'completed'
      ? [{ ...current, role: 'check', step: 'Completed' }]
      : []

  return { stops, segments, checks }
}

function isSegment(datum: DateStop | Segment): datum is Segment {
  return 'kind' in datum
}

function TrajectoryTooltip({
  points,
  timeZone,
}: {
  points: readonly { datum: DateStop | Segment }[]
  timeZone: string
}) {
  const datum = points[0]?.datum
  if (!datum) return null
  if (isSegment(datum)) {
    const heading = datum.kind === 'plan' ? 'Start to first due date' : 'Due date change'
    return (
      <div className="flex max-w-xs flex-col gap-0.5 text-sm">
        <p className="font-medium">{datum.name}</p>
        <p className="tabular-nums">
          {datum.fromLabel} → {datum.toLabel}
        </p>
        <p className="text-muted-foreground">
          {heading} · {datum.movement}
        </p>
        {datum.chain.includes('→') ? <p className="tabular-nums">{datum.chain}</p> : null}
      </div>
    )
  }
  return (
    <div className="flex max-w-xs flex-col gap-0.5 text-sm">
      <p className="font-medium">{datum.name}</p>
      {datum.role === 'check' ? null : (
        <p className="tabular-nums">
          {formatCalendarDate(datum.date)}
          {datum.role === 'start' ? null : (
            <span className="text-muted-foreground">
              {' '}
              · {datum.index} of {datum.count}
            </span>
          )}
        </p>
      )}
      <p className="text-muted-foreground">{datum.step}</p>
      {datum.role !== 'check' && datum.changedAt ? (
        <p className="text-muted-foreground">{formatDateTime(datum.changedAt, timeZone)}</p>
      ) : null}
      {datum.chain.includes('→') ? <p className="tabular-nums">{datum.chain}</p> : null}
    </div>
  )
}

export function ProjectDueDateTrajectory({ projects }: { projects: ProjectOut[] }) {
  const timeZone = useTimezone()
  const series = useMemo(
    () =>
      projects.flatMap((project) => {
        const trajectory = trajectoryFor(project)
        return trajectory ? [trajectory] : []
      }),
    [projects],
  )
  const stops = useMemo(() => series.flatMap((item) => item.stops), [series])
  const segments = useMemo(() => series.flatMap((item) => item.segments), [series])
  const planSegments = useMemo(() => segments.filter((segment) => segment.kind === 'plan'), [segments])
  const shiftSegments = useMemo(() => segments.filter((segment) => segment.kind === 'shift'), [segments])
  const openDots = useMemo(
    () => stops.filter((stop) => stop.role === 'first' || stop.role === 'middle'),
    [stops],
  )
  const checks = useMemo(() => series.flatMap((item) => item.checks), [series])
  const endpointMarks = useMemo(
    () =>
      stops.flatMap((stop) => {
        if (stop.role === 'start') return [{ ...stop, letter: 'S' }]
        if (stop.role === 'current') return [{ ...stop, letter: 'D' }]
        return []
      }),
    [stops],
  )

  const definition = useMemo(() => {
    if (stops.length === 0) return null
    const times = stops.map((stop) => stop.at)
    const min = Math.min(...times)
    const max = Math.max(...times)
    const pad = min === max ? 21 * MS_PER_DAY : Math.max((max - min) * 0.08, 3 * MS_PER_DAY)
    const order: string[] = []
    const labels = new Map<string, string>()
    for (const stop of stops) {
      if (labels.has(stop.key)) continue
      labels.set(stop.key, stop.label)
      order.push(stop.key)
    }
    return defineChart({
      marks: [
        link(planSegments, {
          x1: 'x1',
          x2: 'x2',
          y1: 'key',
          y2: 'key',
          key: 'id',
          stroke: COLOR_PLAN,
          strokeWidth: 2,
          lineCap: 'butt',
        }),
        link(shiftSegments, {
          x1: 'x1',
          x2: 'x2',
          y1: 'key',
          y2: 'key',
          key: 'id',
          stroke: COLOR_SHIFT,
          strokeWidth: 2,
          lineCap: 'butt',
        }),
        dot(openDots, {
          x: 'at',
          y: 'key',
          r: 4.5,
          fill: COLOR_OPEN_FILL,
          stroke: COLOR_OPEN_STROKE,
          strokeWidth: 2,
        }),
        dot(endpointMarks, {
          x: 'at',
          y: 'key',
          r: 7,
          fill: COLOR_OPEN_FILL,
        }),
        text(endpointMarks, {
          x: 'at',
          y: 'key',
          text: 'letter',
          fill: COLOR_OPEN_STROKE,
          fontSize: 11,
          fontWeight: 600,
        }),
        text(checks, {
          x: 'at',
          y: 'key',
          text: () => '✓',
          dx: CHECK_OFFSET,
          fill: COLOR_COMPLETE,
          fontSize: 13,
          fontWeight: 600,
        }),
      ],
      scales: {
        x: {
          scale: scaleLinear().domain([min - pad, max + pad]),
          grid: true,
          axis: { label: 'Date', ticks: { format: dateTick } },
        },
        y: {
          scale: () => scaleBand<string>().domain(order).padding(0.45),
          axis: { ticks: { format: (value) => labels.get(String(value)) ?? String(value) } },
        },
      },
      margin: { left: 168, right: 28, top: 8, bottom: 36 },
      // The default ring is filled with the chart background and uses the
      // point fill as its stroke, which hides an open dot on hover.
      focusRing: {
        fill: 'none',
        stroke: COLOR_OPEN_STROKE,
        strokeWidth: 1.5,
        radius: 8,
      },
      tooltip: {
        use: tooltip,
        items: [
          { id: 'project', label: 'Project', text: (point) => point.datum.name },
          {
            id: 'dates',
            label: 'Dates',
            text: (point) => point.datum.chain,
          },
        ],
      },
    })
  }, [checks, endpointMarks, openDots, planSegments, shiftSegments, stops])

  if (projects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No projects match the current state filter.</p>
    )
  }
  if (stops.length === 0 || definition === null) {
    return <p className="text-sm text-muted-foreground">No due dates to plot.</p>
  }

  return (
    <Chart
      definition={definition}
      height={chartHeight(orderCount(stops))}
      ariaLabel="Due date trajectory"
      renderTooltipBody={({ points }) => (
        <TrajectoryTooltip points={points} timeZone={timeZone} />
      )}
    />
  )
}

function orderCount(stops: DateStop[]): number {
  const keys = new Set(stops.map((stop) => stop.key))
  return keys.size
}
