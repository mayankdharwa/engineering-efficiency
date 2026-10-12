import { barX, defineChart, text } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react/tooltip'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { formatMoney, formatPoints } from '../lib/format'
import type { ProjectOut } from '../types'

const COLOR_BAR = 'var(--primary)'
const COLOR_LABEL_ON_BAR = 'var(--primary-foreground)'
const COLOR_LABEL_OUTSIDE = 'var(--foreground)'
const NAME_MAX = 50

interface ProjectBarRow {
  key: string
  project: string
  label: string
  cost: number
  points: number
  currency: string
}

function chartHeight(count: number): number {
  return Math.max(160, count * 38 + 56)
}

function truncateName(name: string, max = NAME_MAX): string {
  return name.length > max ? `${name.slice(0, max)}...` : name
}

function ProjectTooltipBody({ points }: { points: readonly { datum: ProjectBarRow }[] }) {
  const datum = points[0]?.datum
  if (!datum) return null
    return (
    <div className="flex max-w-xs flex-col gap-1.5">
      <p className="text-sm font-medium text-pretty">
        {datum.project} •{' '}
        <span className="tabular-nums">{formatMoney(datum.cost, datum.currency)}</span>
      </p>
      <div className="grid grid-cols-[auto_auto] justify-between gap-x-8 gap-y-0.5 text-sm">
        <span className="text-muted-foreground">Cost</span>
        <span className="text-right tabular-nums">
          {formatMoney(datum.cost, datum.currency)}
        </span>
        <span className="text-muted-foreground">Points</span>
        <span className="text-right tabular-nums">{formatPoints(datum.points)}</span>
      </div>
    </div>
  )
}

export function ProjectCostChart({ projects }: { projects: ProjectOut[] }) {
  const rows = useMemo((): ProjectBarRow[] => {
    const sorted = [...projects].sort(
      (left, right) =>
        right.cost - left.cost || right.points - left.points || left.name.localeCompare(right.name),
    )
    return sorted.map((project) => ({
      key: String(project.id),
      project: project.name,
      label: `${truncateName(project.name)} • ${formatMoney(project.cost, project.currency)}`,
      cost: project.cost,
      points: project.points,
      currency: project.currency,
    }))
  }, [projects])

  const currency = rows[0]?.currency ?? '$'
  const useCost = rows.some((row) => row.cost > 0)
  const valueKey = useCost ? 'cost' : 'points'
  const maxValue = Math.max(...rows.map((row) => (useCost ? row.cost : row.points)), 0)
  const insideRows = rows.filter((row) => (useCost ? row.cost : row.points) / (maxValue || 1) >= 0.35)
  const outsideRows = rows.filter((row) => !insideRows.includes(row))

  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barX(rows, { x: valueKey, y: 'key', fill: COLOR_BAR }),
          text(insideRows, {
            x: () => 0,
            y: 'key',
            text: 'label',
            anchor: 'start',
            dx: 8,
            fill: COLOR_LABEL_ON_BAR,
            fontSize: 12,
            fontWeight: 500,
          }),
          text(outsideRows, {
            x: valueKey,
            y: 'key',
            text: 'label',
            anchor: 'start',
            dx: 8,
            fill: COLOR_LABEL_OUTSIDE,
            fontSize: 12,
            fontWeight: 500,
          }),
        ],
        scales: {
          x: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: { label: useCost ? `Cost (${currency})` : 'Points' },
          },
          y: {
            scale: () =>
              scaleBand<string>()
                .domain(rows.map((row) => row.key))
                .padding(0.2),
            axis: false,
          },
        },
        margin: { left: 8 },
        clip: false,
        tooltip: {
          use: tooltip,
          items: [
            {
              id: 'project',
              label: 'Project',
              text: (point) => point.datum.project,
            },
            {
              id: 'cost',
              label: 'Cost',
              text: (point) => formatMoney(point.datum.cost, point.datum.currency),
            },
            {
              id: 'points',
              label: 'Points',
              text: (point) => formatPoints(point.datum.points),
            },
          ],
        },
      }),
    [currency, insideRows, outsideRows, rows, useCost, valueKey],
  )

  if (projects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No projects match the current state filter.</p>
    )
  }

  return (
    <Chart
      definition={definition}
      height={chartHeight(rows.length)}
      ariaLabel={useCost ? 'Project cost' : 'Project points'}
      style={{ ['--ts-chart-tooltip-max-width' as string]: '20rem' }}
      renderTooltipBody={({ points }) => <ProjectTooltipBody points={points} />}
    />
  )
}
