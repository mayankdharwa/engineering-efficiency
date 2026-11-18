import { defineChart, dot, link, ruleX, text } from '@tanstack/charts'
import { decorative } from '@tanstack/charts/mark/decorative'
import { Chart } from '@tanstack/charts/react/tooltip'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useTimezone } from '../hooks/useAppSettings'
import { chartHeight, truncateLabel } from '../lib/chart'
import { dayUnit, formatCalendarDate, formatDateTime, formatUtcDay } from '../lib/format'
import { isProjectCompleted } from '../lib/projectState'
import { isoDateInTimeZone, isoDateToUtcMs, MS_PER_DAY } from '../lib/timezone'
import type { ProjectDueDateChangeOut, ProjectOut } from '../types'
import { OptionSelect } from './OptionSelect'

type TrajectorySortKey = 'name' | 'start' | 'due'
type TrajectorySortDirection = 'asc' | 'desc'

const SORT_OPTIONS: { value: TrajectorySortKey; label: string }[] = [
  { value: 'name', label: 'Project name' },
  { value: 'start', label: 'Start date' },
  { value: 'due', label: 'Current due date' },
]

const COLOR_OPEN_FILL = 'var(--card)'
const COLOR_OPEN_STROKE = 'var(--foreground)'
/** Same emerald as the completed tone in the projects table. */
const COLOR_PLAN = 'var(--trajectory-plan)'
/** Same amber as the warning tone in the projects table. */
const COLOR_SHIFT = 'var(--trajectory-shift)'
/** Same emerald as the completed check in the projects table. */
const COLOR_COMPLETE = 'var(--trajectory-complete)'
/** Reference line marking the current day, distinct from the plan/shift tones. */
const COLOR_TODAY = 'var(--trajectory-today)'
/** Dotted line for a due date pulled earlier, signalling a re-plan. */
const COLOR_EARLIER = 'var(--trajectory-earlier)'
const CHECK_OFFSET = 16
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
  earlier: boolean
  heading: string
  fromLabel: string
  toLabel: string
  movement: string
}

function movementLabel(start: number, end: number): string {
  const days = Math.round((end - start) / MS_PER_DAY)
  if (days === 0) return 'Unchanged'
  const count = Math.abs(days)
  return days > 0 ? `${count} ${dayUnit(count)} later` : `${count} ${dayUnit(count)} earlier`
}

function spanLabel(start: number, end: number): string {
  const count = Math.abs(Math.round((end - start) / MS_PER_DAY))
  if (count === 0) return 'Same day'
  return `${count} ${dayUnit(count)}`
}

/** Latest due date the chart marks with D, falling back to the stored target date. */
function currentDueMs(project: ProjectOut): number | null {
  const dates = dueDates(project.due_date_history)
  for (let index = dates.length - 1; index >= 0; index -= 1) {
    const at = isoDateToUtcMs(dates[index]?.date ?? null)
    if (at !== null) return at
  }
  return isoDateToUtcMs(project.target_date)
}

function compareProjects(
  left: ProjectOut,
  right: ProjectOut,
  key: TrajectorySortKey,
  direction: TrajectorySortDirection,
): number {
  const nameOrder =
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id - right.id
  if (key === 'name') return direction === 'asc' ? nameOrder : -nameOrder

  const leftMs = key === 'start' ? isoDateToUtcMs(left.start_date) : currentDueMs(left)
  const rightMs = key === 'start' ? isoDateToUtcMs(right.start_date) : currentDueMs(right)
  if (leftMs === null && rightMs === null) return nameOrder
  if (leftMs === null) return 1
  if (rightMs === null) return -1
  if (leftMs === rightMs) return nameOrder
  const delta = leftMs - rightMs
  return direction === 'asc' ? delta : -delta
}

function sortDirectionLabel(key: TrajectorySortKey, direction: TrajectorySortDirection): string {
  if (key === 'name') return direction === 'asc' ? 'A to Z' : 'Z to A'
  return direction === 'asc' ? 'Earliest first' : 'Latest first'
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
    const at = isoDateToUtcMs(item.date)
    return at === null ? [] : [{ ...item, at }]
  })
  if (dueStops.length === 0) return null

  const startAt = isoDateToUtcMs(project.start_date)
  const startDate = startAt === null ? null : project.start_date
  const dueLabels = dueStops.map((stop) => formatCalendarDate(stop.date))
  const startLabel = startDate ? formatCalendarDate(startDate) : null
  const chain =
    startLabel && startLabel !== dueLabels[0] ? [startLabel, ...dueLabels].join(' → ') : dueLabels.join(' → ')
  const shared = {
    key: String(project.id),
    name: project.name,
    label: truncateLabel(project.name, NAME_MAX),
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
  const finalStop = dueStops[dueStops.length - 1]
  if (finalStop === undefined) return null
  const peakStop = dueStops.reduce((peak, stop) => (stop.at > peak.at ? stop : peak))
  const hasPullback = dueStops.some(
    (stop, index) => index > 0 && stop.at < (dueStops[index - 1]?.at ?? stop.at),
  )
  const beforeStart = startAt === null ? [] : dueStops.filter((stop) => stop.at < startAt)
  const labelAt = (at: number): string => {
    if (startAt === at && startDate) return formatCalendarDate(startDate)
    const stop = dueStops.find((item) => item.at === at)
    return formatCalendarDate(stop?.date ?? finalStop.date)
  }

  // A due date pulled earlier, or one set before the project started, cannot be
  // drawn as the plan bar without covering it. Those stretches become dotted
  // hints while the solid bar runs from the start to the final due date.
  if (hasPullback || beforeStart.length > 0) {
    if (beforeStart.length > 0 && startAt !== null) {
      const earliest = beforeStart.reduce((min, stop) => (stop.at < min.at ? stop : min))
      segments.push({
        ...shared,
        id: `${shared.key}:before-start`,
        x1: earliest.at,
        x2: startAt,
        kind: 'shift',
        earlier: true,
        heading: 'Due date before project start',
        fromLabel: formatCalendarDate(earliest.date),
        toLabel: formatCalendarDate(startDate ?? earliest.date),
        movement: spanLabel(earliest.at, startAt),
      })
    }

    // Green runs from the start to the first due date at or after it.
    const firstSolid = startAt === null ? first : dueStops.find((stop) => stop.at >= startAt)
    const greenEnd =
      firstSolid && firstSolid.at <= finalStop.at ? firstSolid.at : finalStop.at
    if (startAt !== null && startDate && greenEnd > startAt) {
      segments.push({
        ...shared,
        id: `${shared.key}:plan`,
        x1: startAt,
        x2: greenEnd,
        kind: 'plan',
        earlier: false,
        heading: 'Start to first due date',
        fromLabel: formatCalendarDate(startDate),
        toLabel: labelAt(greenEnd),
        movement: spanLabel(startAt, greenEnd),
      })
    }

    // Amber covers every later change up to the final due date.
    const amberStart = startAt !== null ? greenEnd : (firstSolid?.at ?? finalStop.at)
    if (finalStop.at > amberStart) {
      segments.push({
        ...shared,
        id: `${shared.key}:shift:final`,
        x1: amberStart,
        x2: finalStop.at,
        kind: 'shift',
        earlier: false,
        heading: 'Due date change',
        fromLabel: labelAt(amberStart),
        toLabel: formatCalendarDate(finalStop.date),
        movement: movementLabel(amberStart, finalStop.at),
      })
    }

    // Any earlier date that reached past the finish is dotted too.
    if (peakStop.at > finalStop.at) {
      segments.push({
        ...shared,
        id: `${shared.key}:superseded`,
        x1: peakStop.at,
        x2: finalStop.at,
        kind: 'shift',
        earlier: true,
        heading: 'Due date pulled earlier',
        fromLabel: formatCalendarDate(peakStop.date),
        toLabel: formatCalendarDate(finalStop.date),
        movement: movementLabel(peakStop.at, finalStop.at),
      })
    }
  } else {
    if (startAt !== null && startDate && first && startAt !== first.at) {
      segments.push({
        ...shared,
        id: `${shared.key}:plan`,
        x1: startAt,
        x2: first.at,
        kind: 'plan',
        earlier: false,
        heading: 'Start to first due date',
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
        earlier: next.at < previous.at,
        heading: 'Due date change',
        fromLabel: formatCalendarDate(previous.date),
        toLabel: formatCalendarDate(next.date),
        movement: movementLabel(previous.at, next.at),
      })
    }
  }

  const current = stops.find((stop) => stop.role === 'current')
  const checks: DateStop[] =
    current && isProjectCompleted(project.state)
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
    return (
      <div className="flex max-w-xs flex-col gap-0.5 text-sm">
        <p className="font-medium">{datum.name}</p>
        <p className="tabular-nums">
          {datum.fromLabel} → {datum.toLabel}
        </p>
        <p className="text-muted-foreground">
          {datum.heading} · {datum.movement}
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

function TrajectorySortControls({
  sortKey,
  direction,
  onSortKeyChange,
  onDirectionChange,
}: {
  sortKey: TrajectorySortKey
  direction: TrajectorySortDirection
  onSortKeyChange: (key: TrajectorySortKey) => void
  onDirectionChange: (direction: TrajectorySortDirection) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Label htmlFor="trajectory-sort" className="font-normal text-muted-foreground">
        Sort
      </Label>
      <div className="w-48">
        <OptionSelect
          items={SORT_OPTIONS}
          value={sortKey}
          onValueChange={onSortKeyChange}
          id="trajectory-sort"
          className="w-full"
          aria-label="Sort by"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={sortDirectionLabel(sortKey, direction)}
        title={sortDirectionLabel(sortKey, direction)}
        onClick={() => onDirectionChange(direction === 'asc' ? 'desc' : 'asc')}
      >
        {direction === 'asc' ? <ArrowUpIcon /> : <ArrowDownIcon />}
      </Button>
    </div>
  )
}

export function ProjectDueDateTrajectory({ projects }: { projects: ProjectOut[] }) {
  const timeZone = useTimezone()
  const [sortKey, setSortKey] = useState<TrajectorySortKey>('due')
  const [direction, setDirection] = useState<TrajectorySortDirection>('desc')
  // Today's calendar date in the configured timezone, expressed in the same
  // UTC-midnight millis the chart maps due dates to so the line aligns.
  const today = useMemo(() => {
    const iso = isoDateInTimeZone(new Date().toISOString(), timeZone)
    return isoDateToUtcMs(iso)
  }, [timeZone])
  const sortedProjects = useMemo(
    () => [...projects].sort((left, right) => compareProjects(left, right, sortKey, direction)),
    [direction, projects, sortKey],
  )
  const series = useMemo(
    () =>
      sortedProjects.flatMap((project) => {
        const trajectory = trajectoryFor(project)
        return trajectory ? [trajectory] : []
      }),
    [sortedProjects],
  )
  const stops = useMemo(() => series.flatMap((item) => item.stops), [series])
  const segments = useMemo(() => series.flatMap((item) => item.segments), [series])
  const planSegments = useMemo(() => segments.filter((segment) => segment.kind === 'plan'), [segments])
  const shiftSegments = useMemo(
    () => segments.filter((segment) => segment.kind === 'shift' && !segment.earlier),
    [segments],
  )
  const earlierSegments = useMemo(
    () => segments.filter((segment) => segment.kind === 'shift' && segment.earlier),
    [segments],
  )
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
    // The y scale maps the first domain value to the bottom of the plot.
    // `order` is top-to-bottom, so reverse it to keep the first sorted row on top.
    order.reverse()
    // Only draw the reference line when today falls inside the padded domain;
    // otherwise it would paint outside the plot rectangle.
    const todayMark =
      today !== null && today >= min - pad && today <= max + pad ? today : null
    const todayOnRight = todayMark !== null && todayMark > min + (max - min) / 2
    return defineChart({
      marks: [
        ...(todayMark === null
          ? []
          : [
              ruleX([todayMark], {
                id: 'today',
                stroke: COLOR_TODAY,
                strokeWidth: 1.5,
                strokeDasharray: '4 4',
              }),
            ]),
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
        link(earlierSegments, {
          x1: 'x1',
          x2: 'x2',
          y1: 'key',
          y2: 'key',
          key: 'id',
          stroke: COLOR_EARLIER,
          strokeWidth: 2,
          lineCap: 'butt',
          strokeDasharray: '3 3',
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
        ...(todayMark === null
          ? []
          : [
              decorative(
                text([todayMark], {
                  id: 'today-label',
                  x: (value) => value,
                  y: () => 1,
                  yScale: 'today',
                  text: () => 'Today',
                  anchor: todayOnRight ? 'end' : 'start',
                  dx: todayOnRight ? -6 : 6,
                  dy: 10,
                  fill: COLOR_TODAY,
                  fontSize: 11,
                  fontWeight: 600,
                }),
              ),
            ]),
      ],
      scales: {
        x: {
          scale: scaleLinear().domain([min - pad, max + pad]),
          grid: true,
          axis: { label: 'Date', ticks: { format: (value) => formatUtcDay(Number(value)) } },
        },
        y: {
          scale: () => scaleBand<string>().domain(order).padding(0.45),
          axis: { ticks: { format: (value) => labels.get(String(value)) ?? String(value) } },
        },
        // Fixed 0..1 axis used only to park the "Today" label at the plot top.
        today: {
          scale: scaleLinear().domain([0, 1]),
          channel: 'y',
          axis: false,
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
  }, [checks, earlierSegments, endpointMarks, openDots, planSegments, shiftSegments, stops, today])

  if (projects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No projects match the current state filter.</p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <TrajectorySortControls
        sortKey={sortKey}
        direction={direction}
        onSortKeyChange={setSortKey}
        onDirectionChange={setDirection}
      />
      {stops.length === 0 || definition === null ? (
        <p className="text-sm text-muted-foreground">No due dates to plot.</p>
      ) : (
        <Chart
          definition={definition}
          height={chartHeight(distinctProjectCount(stops), { perRow: 36, padding: 56 })}
          ariaLabel="Due date trajectory"
          renderTooltipBody={({ points }) => (
            <TrajectoryTooltip points={points} timeZone={timeZone} />
          )}
        />
      )}
    </div>
  )
}

function distinctProjectCount(stops: DateStop[]): number {
  const keys = new Set(stops.map((stop) => stop.key))
  return keys.size
}
