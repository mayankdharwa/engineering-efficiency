import { defineChart, lineY, ruleY } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { scalePoint } from '@tanstack/charts/scales/point'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { formatCalendarDate, formatPercent } from '../lib/format'
import { velocityTrendWeekdayDates } from '../lib/velocityTrendChart'
import type { VelocityTrendPointOut } from '../types'

const COLOR_LINE = 'var(--primary)'
const COLOR_TARGET = 'var(--muted-foreground)'

interface VelocityTrendChartProps {
  points: VelocityTrendPointOut[]
  startsAt?: string | null
  endsAt?: string | null
  timeZone: string
}

export function VelocityTrendChart({
  points,
  startsAt,
  endsAt,
  timeZone,
}: VelocityTrendChartProps) {
  const chartDates = useMemo(
    () =>
      velocityTrendWeekdayDates(
        startsAt,
        endsAt,
        timeZone,
        points.map((point) => point.date),
      ),
    [endsAt, points, startsAt, timeZone],
  )

  const lineRows = useMemo(() => {
    const velocityByDate = new Map(
      points.map((point) => [point.date, point.velocity ?? null] as const),
    )
    return chartDates.flatMap((date) => {
      const velocity = velocityByDate.get(date)
      return velocity === null || velocity === undefined
        ? []
        : [{ date, velocity }]
    })
  }, [chartDates, points])

  // A configured scale instance keeps this domain; a factory would infer it from line data only.
  const xScale = useMemo(() => scalePoint<string>().domain(chartDates), [chartDates])

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          // 100% reference: on pace.
          ruleY([1], { stroke: COLOR_TARGET, strokeDasharray: '4 4' }),
          lineY(lineRows, { x: 'date', y: 'velocity', stroke: COLOR_LINE, points: true }),
        ],
        scales: {
          x: {
            scale: xScale,
            grid: true,
            axis: { label: 'Day', ticks: { format: (value) => formatCalendarDate(String(value)) } },
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: { label: 'Velocity', ticks: { format: formatPercent } },
          },
        },
        tooltip,
      }),
    [lineRows, xScale],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Velocity trend</CardTitle>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No elapsed working days yet.
          </p>
        ) : (
          <Chart definition={definition} height={240} ariaLabel="Velocity trend by day" />
        )}
      </CardContent>
    </Card>
  )
}
