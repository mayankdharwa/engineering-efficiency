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
import type { VelocityTrendPointOut } from '../types'

const COLOR_LINE = 'var(--primary)'
const COLOR_TARGET = 'var(--muted-foreground)'

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
    [rows],
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
