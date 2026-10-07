import { defineChart, lineY, ruleY } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { scalePoint } from '@tanstack/charts/scales/point'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { formatPercent } from '../lib/format'
import type { VelocityTrendPointOut } from '../types'

const COLOR_LINE = 'var(--primary)'
const COLOR_TARGET = 'var(--muted-foreground)'

const percentFormat = (value: number) => formatPercent(value)

/** Render an ISO date as a short axis label, e.g. "Sep 30". */
function dayLabel(value: unknown): string {
  const date = new Date(`${String(value)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface VelocityTrendChartProps {
  points: VelocityTrendPointOut[]
}

export function VelocityTrendChart({ points }: VelocityTrendChartProps) {
  const rows = useMemo(
    () => points.map((point) => ({ date: point.date, velocity: point.velocity ?? 0 })),
    [points],
  )

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          // 100% reference: on pace.
          ruleY([1], { stroke: COLOR_TARGET, strokeDasharray: '4 4' }),
          lineY(rows, { x: 'date', y: 'velocity', stroke: COLOR_LINE, points: true }),
        ],
        scales: {
          x: {
            scale: () => scalePoint<string>(),
            grid: true,
            axis: { label: 'Day', ticks: { format: dayLabel } },
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: { label: 'Velocity', ticks: { format: percentFormat } },
          },
        },
        tooltip,
      }),
    [rows],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Velocity trend</CardTitle>
        <CardDescription>
          Velocity at the end of each working day so far · 100% = on pace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No elapsed working days yet for this cycle.
          </p>
        ) : (
          <Chart definition={definition} height={240} ariaLabel="Velocity trend by day" />
        )}
      </CardContent>
    </Card>
  )
}
