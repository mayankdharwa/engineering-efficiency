import { colorLegend, defineChart, rect, text } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react/tooltip'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { Fragment, useMemo } from 'react'
import { chartHeight, CHART_SERIES_COLORS, TOOLTIP_MAX_WIDTH_STYLE, truncateLabel } from '../lib/chart'
import { parseHexColor } from '../lib/color'
import { dayUnit, formatCalendarDate, formatPoints } from '../lib/format'
import { toIssueLite } from '../lib/issue'
import {
  compareGroupEffort,
  projectGroupEffort,
  stackGroupEffort,
  UNASSIGNED_GROUP_KEY,
  type GroupEffortGroup,
  type GroupEffortMember,
  type GroupEffortSlice,
} from '../lib/projectGroupEffort'
import { workingDaysForPoints, workingDaysThrough } from '../lib/projectSchedule'
import { isProjectCompleted } from '../lib/projectState'
import type { GroupOut, ProjectOut } from '../types'

const SERIES_SPAN = 'Project Duration'
/** Solid muted fill so the duration rails stay visible around the man-days bar. */
const COLOR_SPAN = 'color-mix(in oklch, var(--muted-foreground) 50%, var(--muted))'
const COLOR_SPAN_STROKE = 'color-mix(in oklch, var(--muted-foreground) 78%, transparent)'
/** Hollow segment, so unassigned work stays visible on the gray duration bar. */
const COLOR_UNASSIGNED = 'var(--background)'
const COLOR_OUTLINE = 'var(--foreground)'
/** Same emerald check the trajectory chart draws beside a completed due date. */
const COLOR_COMPLETE = 'var(--trajectory-complete)'
const COLOR_DELTA = 'var(--muted-foreground)'
/** Gap between the longer bar and the duration-minus-man-days label. */
const DELTA_GAP = 8
/** Gap between that label and the completed check. */
const TICK_GAP = 6
/** Pixel width reserved for the check glyph. */
const CHECK_WIDTH = 14
const NAME_MAX = 28

interface SpanComparison {
  key: string
  project: string
  label: string
  startDate: string
  dueDate: string
  calendarDays: number
  estimateDays: number
  points: number
  slices: GroupEffortSlice[]
  completed: boolean
}

interface LegendEntry {
  key: string
  series: string
  color: string
}

interface SpanMark extends SpanComparison {
  series: string
  x1: number
  x2: number
  y1: number
  y2: number
  groupKey: string | null
}

/** Half the height of the gray duration bar, in rows. The rest of the row is the gap. */
const SPAN_HALF = 0.3
/** Half the height of the points bar drawn over it. */
const POINTS_HALF = 0.15

/** Pixel width of a y-axis label, padded so the text stays inside the chart. */
function leftMarginFor(labels: readonly string[]): number {
  const widest = labels.reduce((max, label) => Math.max(max, estimatedLabelWidth(label)), 0)
  return Math.ceil(widest + 24)
}

function estimatedLabelWidth(label: string): number {
  const fontSize = 11
  let em = 0
  for (const character of label) {
    if (/\s/u.test(character)) em += 0.4
    else if (/[mwMW@#%&]/u.test(character)) em += 1.05
    else if (/[A-Z]/u.test(character)) em += 0.78
    else if (/[ilI1|!.,:;'`]/u.test(character)) em += 0.4
    else em += 0.68
  }
  return em * fontSize
}

function formatDayCount(days: number): string {
  return `${formatPoints(days)} ${dayUnit(days)}`
}

/** Absolute gap between duration and man days, such as `2 days` or `0.5 days`. */
function formatDeltaDays(days: number): string {
  const magnitude = Math.abs(days)
  return `${formatPoints(magnitude)} ${dayUnit(magnitude)}`
}

function deltaDays(comparison: SpanComparison): number {
  return comparison.calendarDays - comparison.estimateDays
}

function barEnd(comparison: SpanComparison): number {
  return Math.max(comparison.calendarDays, comparison.estimateDays)
}

function comparisonFor(
  project: ProjectOut,
  members: readonly GroupEffortMember[],
  groups: readonly GroupEffortGroup[],
): SpanComparison | null {
  if (!project.start_date || !project.target_date) return null
  const calendarDays = workingDaysThrough(project.start_date, project.target_date)
  if (calendarDays === null) return null
  const slices = projectGroupEffort(
    project.issues.map(toIssueLite),
    members,
    groups,
  )
  const points = slices.reduce((sum, slice) => sum + slice.points, 0)
  return {
    key: String(project.id),
    project: project.name,
    label: truncateLabel(project.name, NAME_MAX),
    startDate: project.start_date,
    dueDate: project.target_date,
    calendarDays,
    estimateDays: workingDaysForPoints(points),
    points,
    slices,
    completed: isProjectCompleted(project.state),
  }
}

function compareSpan(left: SpanComparison, right: SpanComparison): number {
  return (
    right.calendarDays - left.calendarDays ||
    right.estimateDays - left.estimateDays ||
    left.project.localeCompare(right.project) ||
    Number(left.key) - Number(right.key)
  )
}

function legendFor(comparisons: readonly SpanComparison[]): LegendEntry[] {
  const byKey = new Map<string, GroupEffortSlice>()
  for (const comparison of comparisons) {
    for (const slice of comparison.slices) {
      if (!byKey.has(slice.key)) byKey.set(slice.key, slice)
    }
  }
  const used = new Set<string>([SERIES_SPAN])
  let fallback = 0
  return [...byKey.values()].sort(compareGroupEffort).map((slice) => {
    let series = slice.label
    if (used.has(series)) series = `${slice.label} (${slice.key})`
    used.add(series)
    const hex = slice.key === UNASSIGNED_GROUP_KEY ? null : parseHexColor(slice.color)
    const color =
      slice.key === UNASSIGNED_GROUP_KEY
        ? COLOR_UNASSIGNED
        : (hex ??
          CHART_SERIES_COLORS[fallback++ % CHART_SERIES_COLORS.length] ??
          COLOR_UNASSIGNED)
    return { key: slice.key, series, color }
  })
}

function withLegendColors(
  slices: readonly GroupEffortSlice[],
  legend: readonly LegendEntry[],
): GroupEffortSlice[] {
  const colorByKey = new Map(legend.map((entry) => [entry.key, entry.color]))
  return slices.map((slice) => ({
    ...slice,
    color: colorByKey.get(slice.key) ?? slice.color,
  }))
}

function marksFor(
  comparisons: readonly SpanComparison[],
  legend: readonly LegendEntry[],
): {
  span: SpanMark[]
  groups: SpanMark[]
  outlines: SpanMark[]
  deltas: SpanMark[]
  checks: SpanMark[]
} {
  const seriesByKey = new Map(legend.map((entry) => [entry.key, entry.series]))
  const span: SpanMark[] = []
  const groups: SpanMark[] = []
  const outlines: SpanMark[] = []
  const deltas: SpanMark[] = []
  const checks: SpanMark[] = []
  comparisons.forEach((comparison, index) => {
    const slices = withLegendColors(comparison.slices, legend)
    const painted = { ...comparison, slices }
    span.push({
      ...painted,
      series: SERIES_SPAN,
      x1: 0,
      x2: comparison.calendarDays,
      y1: index - SPAN_HALF,
      y2: index + SPAN_HALF,
      groupKey: null,
    })
    const segments = stackGroupEffort(
      slices,
      legend.map((entry) => entry.key),
    )
    for (const segment of segments) {
      groups.push({
        ...painted,
        series: seriesByKey.get(segment.key) ?? segment.label,
        x1: segment.x1,
        x2: segment.x2,
        y1: index - POINTS_HALF,
        y2: index + POINTS_HALF,
        groupKey: segment.key,
      })
    }
    if (segments.length > 0) {
      outlines.push({
        ...painted,
        series: SERIES_SPAN,
        x1: 0,
        x2: comparison.estimateDays,
        y1: index - POINTS_HALF,
        y2: index + POINTS_HALF,
        groupKey: null,
      })
    }
    const end = barEnd(comparison)
    deltas.push({
      ...painted,
      series: SERIES_SPAN,
      x1: end,
      x2: end,
      y1: index,
      y2: index,
      groupKey: null,
    })
    if (comparison.completed) {
      checks.push({
        ...painted,
        series: SERIES_SPAN,
        x1: end,
        x2: end,
        y1: index,
        y2: index,
        groupKey: null,
      })
    }
  })
  return { span, groups, outlines, deltas, checks }
}

function labelPositions(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index)
}

/**
 * Working-day domain. Starts at 0 unless a due date is before its start date.
 * A little room past the longest value keeps that bar end off the plot edge.
 */
function xExtent(marks: readonly SpanMark[]): [number, number] {
  if (marks.length === 0) return [0, 1]
  const days = marks.flatMap((mark) => [mark.x1, mark.x2])
  const lowest = Math.min(...days)
  const highest = Math.max(0, ...days)
  const span = Math.max(highest - Math.min(0, lowest), 1)
  const pad = Math.max(0.75, span * 0.04)
  return [lowest < 0 ? lowest : 0, highest + pad]
}

function SpanTooltipBody({ points }: { points: readonly { datum: SpanMark }[] }) {
  const datum = points[0]?.datum
  if (!datum) return null
  return (
    <div className="flex max-w-xs flex-col gap-1.5">
      <p className="text-sm font-medium text-pretty">{datum.project}</p>
      <div className="grid grid-cols-[auto_auto] items-center justify-between gap-x-8 gap-y-0.5 text-sm">
        {datum.completed ? (
          <>
            <span className="text-muted-foreground">Status</span>
            <span className="text-right" style={{ color: COLOR_COMPLETE }}>
              Completed
            </span>
          </>
        ) : null}
        <span className="text-muted-foreground">Project Duration</span>
        <span className="text-right tabular-nums">{formatDayCount(datum.calendarDays)}</span>
        <span className="text-muted-foreground">Man Days</span>
        <span className="text-right tabular-nums">{formatDayCount(datum.estimateDays)}</span>
        <span className="text-muted-foreground">Difference</span>
        <span className="text-right tabular-nums">{formatDeltaDays(deltaDays(datum))}</span>
        {datum.slices.map((slice) => {
          const active = slice.key === datum.groupKey
          return (
            <Fragment key={slice.key}>
              <span className={active ? 'font-medium' : 'text-muted-foreground'}>
                <span
                  className="mr-1.5 inline-block size-2 rounded-full align-middle"
                  style={{
                    backgroundColor: slice.color ?? COLOR_UNASSIGNED,
                    boxShadow: `inset 0 0 0 1px ${COLOR_OUTLINE}`,
                  }}
                />
                {slice.label}
              </span>
              <span className={`text-right tabular-nums ${active ? 'font-medium' : ''}`}>
                {formatDayCount(slice.days)}
              </span>
            </Fragment>
          )
        })}
        <span className="text-muted-foreground">Start</span>
        <span className="text-right tabular-nums">{formatCalendarDate(datum.startDate)}</span>
        <span className="text-muted-foreground">Due</span>
        <span className="text-right tabular-nums">{formatCalendarDate(datum.dueDate)}</span>
        <span className="text-muted-foreground">Points</span>
        <span className="text-right tabular-nums">{formatPoints(datum.points)}</span>
      </div>
    </div>
  )
}

export function ProjectSpanChart({
  projects,
  members,
  groups,
}: {
  projects: ProjectOut[]
  members: readonly GroupEffortMember[]
  groups: readonly GroupOut[]
}) {
  const effortGroups = useMemo(
    () => groups.map((group) => ({ id: group.id, name: group.name, color: group.color })),
    [groups],
  )
  const comparisons = useMemo(() => {
    return projects
      .flatMap((project) => {
        const comparison = comparisonFor(project, members, effortGroups)
        return comparison ? [comparison] : []
      })
      .sort(compareSpan)
  }, [effortGroups, members, projects])
  const legend = useMemo(() => legendFor(comparisons), [comparisons])
  const marks = useMemo(() => marksFor(comparisons, legend), [comparisons, legend])
  const labels = useMemo(() => labelPositions(comparisons.length), [comparisons.length])
  const yDomain = useMemo((): [number, number] => {
    if (comparisons.length === 0) return [0, 1]
    return [-0.5, comparisons.length - 0.5]
  }, [comparisons.length])
  const xDomain = useMemo(
    () => xExtent([...marks.span, ...marks.groups]),
    [marks.groups, marks.span],
  )
  const colorDomain = useMemo(
    () => [SERIES_SPAN, ...legend.map((entry) => entry.series)],
    [legend],
  )
  const colorRange = useMemo(
    () => [COLOR_SPAN, ...legend.map((entry) => entry.color)],
    [legend],
  )
  const marginLeft = useMemo(
    () => leftMarginFor(comparisons.map((comparison) => comparison.label)),
    [comparisons],
  )
  const marginRight = useMemo(() => {
    const widest = comparisons.reduce((max, comparison) => {
      const label = estimatedLabelWidth(formatDeltaDays(deltaDays(comparison)))
      const check = comparison.completed ? TICK_GAP + CHECK_WIDTH : 0
      return Math.max(max, label + check)
    }, 0)
    return Math.ceil(DELTA_GAP + widest + 8)
  }, [comparisons])

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          rect(marks.span, {
            x1: 'x1',
            x2: 'x2',
            y1: 'y1',
            y2: 'y2',
            color: 'series',
            radius: 2,
            stroke: COLOR_SPAN_STROKE,
            strokeWidth: 1,
            key: (mark) => `${mark.key}-span`,
          }),
          rect(marks.groups, {
            x1: 'x1',
            x2: 'x2',
            y1: 'y1',
            y2: 'y2',
            color: 'series',
            inset: 0,
            key: (mark) => `${mark.key}-${mark.groupKey}`,
          }),
          rect(marks.outlines, {
            x1: 'x1',
            x2: 'x2',
            y1: 'y1',
            y2: 'y2',
            fill: 'none',
            inset: 0,
            stroke: COLOR_OUTLINE,
            strokeWidth: 1.25,
            key: (mark) => `${mark.key}-outline`,
          }),
          text(marks.deltas, {
            x: 'x2',
            y: 'y1',
            text: (mark) => formatDeltaDays(deltaDays(mark)),
            anchor: 'start',
            dx: DELTA_GAP,
            fill: COLOR_DELTA,
            fontSize: 11,
            fontWeight: 500,
            key: (mark) => `${mark.key}-delta`,
          }),
          text(marks.checks, {
            x: 'x2',
            y: 'y1',
            text: () => '✓',
            anchor: 'start',
            dx: (mark) =>
              DELTA_GAP + estimatedLabelWidth(formatDeltaDays(deltaDays(mark))) + TICK_GAP,
            fill: COLOR_COMPLETE,
            fontSize: 13,
            fontWeight: 600,
            key: (mark) => `${mark.key}-check`,
          }),
        ],
        scales: {
          x: {
            scale: scaleLinear().domain(xDomain),
            // Rounding a domain that starts at 0 stays on 0. Rounding a small
            // negative span would jump the first tick well below the data.
            nice: xDomain[0] >= 0,
            grid: true,
            axis: {
              label: 'Working days',
              ticks: { format: (value: number) => formatPoints(value) },
            },
          },
          y: {
            scale: scaleLinear().domain(yDomain),
            reverse: true,
            grid: false,
            axis: {
              ticks: {
                values: labels,
                size: 0,
                format: (value) => comparisons[Math.round(value)]?.label ?? '',
              },
              tickLabels: { thin: false },
            },
          },
        },
        color: {
          domain: colorDomain,
          range: colorRange,
          legend: colorLegend({ placement: 'top' }),
        },
        // Top stays automatic so the legend keeps a gap above the bars.
        // Right room keeps the day difference, then the completed check, inside the chart.
        margin: { left: marginLeft, right: marginRight, bottom: 44 },
        tooltip: {
          use: tooltip,
          items: [
            { id: 'project', label: 'Project', text: (point) => point.datum.project },
            {
              id: 'span',
              label: 'Project Duration',
              text: (point) => formatDayCount(point.datum.calendarDays),
            },
            {
              id: 'estimate',
              label: 'Man Days',
              text: (point) => formatDayCount(point.datum.estimateDays),
            },
            {
              id: 'group',
              label: 'Group',
              text: (point) =>
                point.datum.slices.find((slice) => slice.key === point.datum.groupKey)?.label ??
                'All groups',
            },
          ],
        },
      }),
    [colorDomain, colorRange, comparisons, labels, marginLeft, marginRight, marks, xDomain, yDomain],
  )

  if (projects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No projects match the current filters.</p>
    )
  }

  if (comparisons.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No projects have both a start date and a due date.
      </p>
    )
  }

  return (
    <Chart
      definition={definition}
      height={chartHeight(comparisons.length, { perRow: 40, padding: 108 })}
      ariaLabel="Project duration versus man days, split by group"
      style={TOOLTIP_MAX_WIDTH_STYLE}
      renderTooltipBody={({ points }) => <SpanTooltipBody points={points} />}
    />
  )
}
