import { barX, colorLegend, defineChart, link, ruleX, text, tickX } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { decorative } from '@tanstack/charts/mark/decorative'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  placeCycleBars,
  type AnalyticsChartModel,
  type AnalyticsSeries,
} from '../lib/analyticsSeries'
import { contrastText, isHexColor } from '../lib/color'
import { TOOLTIP_MAX_WIDTH_STYLE, truncateLabel } from '../lib/chart'
import { formatPercent } from '../lib/format'

const REFERENCE = 'var(--muted-foreground)'
/** Theme foreground, so the team marker is black on a light background. */
const TEAM_LINE = 'var(--foreground)'
const TEAM_CAP = 14
/** Share of the axis a bar needs before its percent fits inside the fill. */
const LABEL_INSIDE = 0.18
/** Card-colored copies behind the team percent so it stays readable on a bar. */
const TEAM_LABEL_HALO: readonly [number, number][] = [
  [-1.5, 0],
  [1.5, 0],
  [0, -1.5],
  [0, 1.5],
  [-1.5, -1.5],
  [1.5, -1.5],
  [-1.5, 1.5],
  [1.5, 1.5],
]

interface CycleBarRow {
  cycle: string
  series: string
  value: number
}

function rowsFor(series: AnalyticsSeries, cycles: string[]): CycleBarRow[] {
  const rows: CycleBarRow[] = []
  cycles.forEach((cycle, index) => {
    const value = series.values[index]
    if (value === null || value === undefined) return
    rows.push({ cycle, series: series.label, value })
  })
  return rows
}

interface CycleMetricChartProps {
  title: string
  team: AnalyticsChartModel
  groups: AnalyticsChartModel
  valueLabel: string
  ariaLabel: string
  /** Matches the heatmap rendered in the same row. */
  height: number
}

/**
 * Groups as horizontal bars, newest cycle at the top. The team value is a
 * black line with end caps through the middle of that cycle, labeled just
 * past the right cap. The dashed line is 100%.
 */
export function CycleMetricChart({
  title,
  team,
  groups,
  valueLabel,
  ariaLabel,
  height,
}: CycleMetricChartProps) {
  const cycles = team.cycles.length > 0 ? team.cycles : groups.cycles
  const teamSeries = team.series[0]
  const groupSeries = groups.series
  const legendSeries = useMemo(
    () => [...(teamSeries ? [{ ...teamSeries, color: TEAM_LINE }] : []), ...groupSeries],
    [groupSeries, teamSeries],
  )
  const groupOrder = useMemo(() => groupSeries.map((series) => series.label), [groupSeries])
  const cycleOrder = useMemo(() => [...cycles].reverse(), [cycles])
  const groupRows = useMemo(
    () => groupSeries.flatMap((series) => rowsFor(series, cycles)),
    [cycles, groupSeries],
  )
  const teamRows = useMemo(
    () => (teamSeries ? rowsFor(teamSeries, cycles) : []),
    [cycles, teamSeries],
  )
  const hasValue = groupRows.length > 0 || teamRows.length > 0
  const layout = useMemo(
    () =>
      placeCycleBars(
        cycleOrder,
        groupOrder,
        groupRows,
        teamRows.map((row) => row.cycle),
      ),
    [cycleOrder, groupOrder, groupRows, teamRows],
  )
  const teamMarks = useMemo(() => {
    const valueByCycle = new Map(teamRows.map((row) => [row.cycle, row.value]))
    const label = teamSeries?.label ?? 'Team'
    return layout.ticks.flatMap((tick) => {
      const value = valueByCycle.get(tick.label)
      if (value === undefined) return []
      return [{ cycle: tick.label, series: label, value, y: tick.y }]
    })
  }, [layout.ticks, teamRows, teamSeries?.label])
  const xScale = useMemo(() => {
    const peak = Math.max(1, ...groupRows.map((row) => row.value), ...teamRows.map((row) => row.value))
    return scaleLinear().domain([0, peak * 1.2])
  }, [groupRows, teamRows])
  const yScale = useMemo(() => scaleLinear().domain(layout.domain), [layout.domain])
  const colorBySeries = useMemo(
    () => new Map(groupSeries.map((series) => [series.label, series.color])),
    [groupSeries],
  )
  const barLabels = useMemo(() => {
    const domainMax = xScale.domain()[1]
    const inside = layout.bars.filter((bar) => {
      const color = colorBySeries.get(bar.series)
      return bar.value / domainMax >= LABEL_INSIDE && isHexColor(color)
    })
    const outside = layout.bars.filter((bar) => !inside.includes(bar))
    return { inside, outside }
  }, [colorBySeries, layout.bars, xScale])

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barX(layout.bars, {
            x: 'value',
            y: 'y',
            color: 'series',
            key: (row) => `${row.series}|${row.cycle}`,
          }),
          ruleX([1], { stroke: REFERENCE, strokeDasharray: '4 4' }),
          link(teamMarks, {
            x1: () => 0,
            y1: 'y',
            x2: 'value',
            y2: 'y',
            stroke: TEAM_LINE,
            strokeWidth: 2,
            lineCap: 'butt',
            key: (row) => `${row.cycle}-team`,
          }),
          decorative(
            tickX(teamMarks, {
              x: () => 0,
              y: 'y',
              length: TEAM_CAP,
              stroke: TEAM_LINE,
              strokeWidth: 2,
              key: (row) => `${row.cycle}-team-start`,
            }),
          ),
          decorative(
            tickX(teamMarks, {
              x: 'value',
              y: 'y',
              length: TEAM_CAP,
              stroke: TEAM_LINE,
              strokeWidth: 2,
              key: (row) => `${row.cycle}-team-end`,
            }),
          ),
          decorative(
            text(barLabels.inside, {
              x: 'value',
              y: 'y',
              text: (row) => formatPercent(row.value),
              anchor: 'end',
              dx: -8,
              fill: (row) => contrastText(colorBySeries.get(row.series) ?? '#000000'),
              fontSize: 11,
              fontWeight: 500,
              key: (row) => `${row.series}|${row.cycle}|label`,
            }),
          ),
          decorative(
            text(barLabels.outside, {
              x: 'value',
              y: 'y',
              text: (row) => formatPercent(row.value),
              anchor: 'start',
              dx: 6,
              fill: TEAM_LINE,
              fontSize: 11,
              fontWeight: 500,
              key: (row) => `${row.series}|${row.cycle}|label`,
            }),
          ),
          ...TEAM_LABEL_HALO.map(([offsetX, offsetY]) =>
            decorative(
              text(teamMarks, {
                x: 'value',
                y: 'y',
                text: (row) => formatPercent(row.value),
                anchor: 'start',
                dx: 8 + offsetX,
                dy: offsetY,
                fill: 'var(--card)',
                fontSize: 11,
                fontWeight: 600,
                key: (row) => `${row.cycle}-team-label-${offsetX}-${offsetY}`,
              }),
            ),
          ),
          decorative(
            text(teamMarks, {
              x: 'value',
              y: 'y',
              text: (row) => formatPercent(row.value),
              anchor: 'start',
              dx: 8,
              fill: TEAM_LINE,
              fontSize: 11,
              fontWeight: 600,
              key: (row) => `${row.cycle}-team-label`,
            }),
          ),
        ],
        scales: {
          x: {
            scale: xScale,
            grid: true,
            axis: { label: valueLabel, ticks: { format: formatPercent } },
          },
          y: {
            scale: yScale,
            axis: {
              label: 'Cycle',
              ticks: {
                values: layout.ticks.map((tick) => tick.y),
                size: 0,
                format: (value) => {
                  const tick = layout.ticks.find((item) => Math.abs(item.y - Number(value)) < 1e-6)
                  return tick ? truncateLabel(tick.label, 22) : ''
                },
              },
              tickLabels: { thin: false },
            },
          },
        },
        color: {
          domain: legendSeries.map((series) => series.label),
          range: legendSeries.map((series) => series.color),
          legend: colorLegend(),
        },
        clip: false,
        tooltip: {
          use: tooltip,
          items: [
            { field: 'cycle', label: 'Cycle' },
            { field: 'series', label: 'Series' },
            {
              field: 'value',
              label: valueLabel,
              text: (point) => formatPercent(point.datum.value),
            },
          ],
        },
      }),
    [barLabels, colorBySeries, layout.bars, layout.ticks, legendSeries, teamMarks, valueLabel, xScale, yScale],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {hasValue ? (
          <Chart
            definition={definition}
            height={height}
            ariaLabel={ariaLabel}
            style={TOOLTIP_MAX_WIDTH_STYLE}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No data for these cycles yet.</p>
        )}
      </CardContent>
    </Card>
  )
}
