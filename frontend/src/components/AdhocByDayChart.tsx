import { barY, defineChart, stack, text } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { CHART_SERIES_COLORS } from '../lib/chart'
import { formatCalendarDate, formatPercent, formatPoints } from '../lib/format'
import type { AdhocByDayPointOut } from '../types'

/** Distinct fills so many assignees stay separable; cycles if the roster is larger. */
const ASSIGNEE_COLORS = [
  ...CHART_SERIES_COLORS,
  'oklch(0.62 0.14 230)',
  'oklch(0.58 0.13 160)',
  'oklch(0.60 0.14 330)',
  'oklch(0.52 0.12 280)',
  'oklch(0.64 0.14 40)',
  'oklch(0.50 0.10 200)',
  'oklch(0.68 0.12 120)',
  'oklch(0.55 0.14 20)',
  'oklch(0.48 0.08 250)',
]

interface AdhocBarRow {
  date: string
  assignee: string
  points: number
  share: number
  dayTotal: number
  label: string
}

interface AdhocByDayChartProps {
  dates: string[]
  points: AdhocByDayPointOut[]
}

export function AdhocByDayChart({ dates, points }: AdhocByDayChartProps) {
  const { rows, assignees, domain, dayTotals } = useMemo(() => {
    const totals = new Map<string, number>()
    for (const point of points) {
      totals.set(point.date, (totals.get(point.date) ?? 0) + point.points)
    }
    const nextRows: AdhocBarRow[] = points.map((point) => {
      const dayTotal = totals.get(point.date) ?? 0
      return {
        date: point.date,
        assignee: point.assignee,
        points: point.points,
        share: dayTotal > 0 ? point.points / dayTotal : 0,
        dayTotal,
        label: formatPoints(dayTotal),
      }
    })
    const extraDates = [...new Set(points.map((point) => point.date))].filter(
      (date) => !dates.includes(date),
    )
    const nextDomain = extraDates.length === 0 ? dates : [...dates, ...extraDates].sort()
    const nextAssignees = [...new Set(nextRows.map((row) => row.assignee))].sort((left, right) =>
      left.localeCompare(right),
    )
    const seen = new Set<string>()
    const nextTotals = nextRows.filter((row) => {
      if (seen.has(row.date) || row.dayTotal <= 0) return false
      seen.add(row.date)
      return true
    })
    return {
      rows: nextRows,
      assignees: nextAssignees,
      domain: nextDomain,
      dayTotals: nextTotals,
    }
  }, [dates, points])

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barY(rows, {
            x: 'date',
            y: 'points',
            color: 'assignee',
            layout: stack({ order: assignees, offset: 'normalize' }),
          }),
          text(dayTotals, {
            x: 'date',
            y: () => 1,
            text: 'label',
            key: 'date',
            dy: -10,
            fill: 'var(--foreground)',
            fontSize: 11,
            fontWeight: 500,
          }),
        ],
        scales: {
          x: {
            scale: () => scaleBand<string>().domain(domain).paddingInner(0.22).paddingOuter(0.08),
            axis: { label: 'Day', ticks: { format: (value) => formatCalendarDate(String(value)) } },
          },
          y: {
            scale: scaleLinear().domain([0, 1]),
            grid: true,
            axis: { label: 'Share of adhoc points', ticks: { format: formatPercent } },
          },
        },
        color: {
          domain: assignees,
          range: ASSIGNEE_COLORS,
        },
        margin: { top: 18 },
        clip: false,
        tooltip: {
          use: tooltip,
          items: [
            {
              field: 'date',
              label: 'Day',
              text: (point) => formatCalendarDate(point.datum.date),
            },
            { field: 'assignee', label: 'Assignee' },
            {
              field: 'points',
              label: 'Points',
              text: (point) => formatPoints(point.datum.points),
            },
            {
              field: 'share',
              label: 'Share',
              text: (point) => formatPercent(point.datum.share),
            },
            {
              field: 'dayTotal',
              label: 'Day total',
              text: (point) => formatPoints(point.datum.dayTotal),
            },
          ],
        },
      }),
    [assignees, dayTotals, domain, rows],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Adhoc points by day</CardTitle>
        <CardDescription>
          Share of adhoc points attached each day, by assignee. Adhoc is work added after
          the first day.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No estimated adhoc points in this cycle.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <Chart
              definition={definition}
              height={560}
              ariaLabel="Adhoc points added each day by assignee"
            />
            <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
              {assignees.map((assignee, index) => (
                <li key={assignee} className="flex items-center gap-1.5 text-xs text-foreground">
                  <span
                    className="size-2.5 shrink-0 rounded-xs"
                    style={{ background: ASSIGNEE_COLORS[index % ASSIGNEE_COLORS.length] }}
                    aria-hidden
                  />
                  <span className="whitespace-nowrap">{assignee}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
