import { cell, colorLegend, defineChart, text } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleOrdinal } from '@tanstack/charts/scales/ordinal'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  heatLevelHex,
  type AnalyticsMetricKey,
  type MemberHeatmapCell,
  type MemberHeatmapModel,
} from '../lib/analyticsSeries'
import { contrastText } from '../lib/color'
import { formatPercent } from '../lib/format'

interface MemberHeatmapChartProps {
  title: string
  model: MemberHeatmapModel
  metric: AnalyticsMetricKey
  valueLabel: string
  ariaLabel: string
  height: number
}

/** Members down the side, cycles across the top; each cell is bucketed by value. */
export function MemberHeatmapChart({
  title,
  model,
  metric,
  valueLabel,
  ariaLabel,
  height,
}: MemberHeatmapChartProps) {
  const measured = useMemo(
    () => model.cells.filter((item): item is MemberHeatmapCell & { value: number } => item.value !== null),
    [model.cells],
  )

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          cell(model.cells, {
            x: 'cycle',
            y: 'member',
            color: 'level',
            key: (row) => `${row.member}|${row.cycle}`,
            inset: 1,
          }),
          text(measured, {
            x: 'cycle',
            y: 'member',
            text: (row) => formatPercent(row.value),
            fill: (row) => contrastText(heatLevelHex(row.level, metric) ?? '#000000'),
            fontSize: 11,
            fontWeight: 500,
          }),
        ],
        scales: {
          x: {
            scale: () => scaleBand<string>().domain(model.cycles).padding(0.04),
            axis: { label: 'Cycle' },
          },
          y: {
            scale: () => scaleBand<string>().domain(model.members).padding(0.04),
            axis: { label: 'Member' },
          },
        },
        color: {
          scale: scaleOrdinal(model.domain, model.range),
          legend: colorLegend({ label: valueLabel }),
        },
        tooltip: {
          use: tooltip,
          items: [
            { channel: 'x', label: 'Cycle' },
            { channel: 'y', label: 'Member' },
            {
              field: 'value',
              label: valueLabel,
              text: (point) =>
                point.datum.value === null ? 'No data' : formatPercent(point.datum.value),
            },
          ],
        },
      }),
    [
      measured,
      metric,
      model.cells,
      model.cycles,
      model.domain,
      model.members,
      model.range,
      valueLabel,
    ],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {measured.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data for these cycles yet.</p>
        ) : (
          <Chart
            definition={definition}
            height={height}
            ariaLabel={ariaLabel}
          />
        )}
      </CardContent>
    </Card>
  )
}
