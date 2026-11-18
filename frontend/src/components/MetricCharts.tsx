import { barX, colorLegend, defineChart, ruleX, stack } from '@tanstack/charts'
import { angleGrid, polar, radialArea, radialGrid } from '@tanstack/charts/polar'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { scalePoint } from '@tanstack/charts/scales/point'
import { tooltip } from '@tanstack/charts/tooltip'
import { curveLinearClosed } from 'd3-shape'
import { useMemo } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { chartHeight, truncateLabel } from '../lib/chart'
import { formatPercent, formatPoints } from '../lib/format'
import type { MemberMetricsOut } from '../types'

// Theme-driven colors: charts follow the shadcn preset (light/dark aware).
// A shared neutral/primary pair is reused across charts: neutral is the base
// (capacity / adhoc) and primary is the filled work (taken / planned).
const COLOR_TAKEN = 'var(--primary)'
const COLOR_CAPACITY = 'var(--muted-foreground)'

/** Velocity rings drawn as polygon guides on the radar, as fractions of done/expected. */
const VELOCITY_RINGS = [0.25, 0.5, 0.75, 1, 1.25, 1.5] as const
/** Cap on spoke labels so long member names do not collide around the radar. */
const MAX_SPOKE_LABEL = 14

interface MetricChartsProps {
  members: MemberMetricsOut[]
  fullCapacityPoints: number
}

/**
 * The three core cycle charts. Each definition is memoized against the data it
 * captures (definition identity is the chart's update boundary).
 */
export function MetricCharts({ members, fullCapacityPoints }: MetricChartsProps) {
  // Charts only show people who count toward capacity; not-counted members and
  // the synthetic "Unassigned" aggregate are excluded.
  const counted = useMemo(
    () => members.filter((member) => member.counts_toward_capacity),
    [members],
  )
  const workingMembers = useMemo(
    () => counted.filter((member) => member.taken_points > 0),
    [counted],
  )
  // Row-1 cards share this height so the velocity radar grows with the roster
  // instead of leaving the space below it empty.
  const memberChartHeight = chartHeight(counted.length, { perRow: 34, padding: 56 })

  const takenVsCapacity = useMemo(() => {
    const capacityRows = counted.map((member) => ({
      member: member.name,
      points: member.capacity_points,
    }))
    const takenRows = counted.map((member) => ({
      member: member.name,
      points: member.taken_points,
    }))
    return defineChart({
      marks: [
        // Capacity is the empty "pipe" drawn behind; points taken fill it from
        // the left like water. When taken exceeds capacity it visibly overflows.
        barX(capacityRows, { x: 'points', y: 'member', fill: COLOR_CAPACITY }),
        barX(takenRows, { x: 'points', y: 'member', fill: COLOR_TAKEN }),
        // Full-time capacity (working days × points per day) as a dotted line.
        ruleX([fullCapacityPoints], {
          stroke: 'var(--foreground)',
          strokeDasharray: '2 3',
        }),
      ],
      scales: {
        x: { scale: scaleLinear, nice: true, grid: true, axis: { label: 'Points' } },
        y: { scale: () => scaleBand<string>().padding(0.2) },
      },
      color: {
        domain: ['Taken', 'Capacity'],
        range: [COLOR_TAKEN, COLOR_CAPACITY],
        legend: colorLegend({ label: 'Points' }),
      },
      tooltip,
    })
  }, [counted, fullCapacityPoints])

  const velocity = useMemo(() => {
    const rows = workingMembers.map((member) => ({
      member: member.name,
      velocity: member.velocity ?? 0,
    }))
    const names = rows.map((row) => row.member)
    // Keep 100% (on pace) inside the domain even when everyone is behind it.
    const radiusScale = scaleLinear()
      .domain([0, Math.max(1, ...rows.map((row) => row.velocity))])
      .nice()
    const radiusMax = radiusScale.domain()[1] ?? 1
    const ringValues = VELOCITY_RINGS.filter((value) => value <= radiusMax + 1e-9)
    // Park ring labels halfway between two spokes so they never sit on one.
    const ringLabelAngle = names.length > 0 ? Math.PI / names.length : 0
    return defineChart({
      marks: [
        polar({
          radiusRatio: 0.85,
          scales: {
            angle: { scale: scalePoint<string>().domain(names), wrap: true },
            radius: { scale: radiusScale },
          },
          guides: [
            radialGrid({
              values: ringValues,
              shape: 'polygon',
              labels: true,
              labelAngle: ringLabelAngle,
              format: (value) => formatPercent(Number(value)),
              stroke: 'var(--border)',
              labelFill: 'var(--muted-foreground)',
              labelFontSize: 11,
            }),
            // Emphasize the on-pace (100%) ring: the reference the bars used as a rule.
            radialGrid({
              values: [1],
              shape: 'polygon',
              labels: false,
              stroke: 'var(--foreground)',
              strokeWidth: 2,
            }),
            angleGrid({
              labels: true,
              format: (value) => truncateLabel(String(value), MAX_SPOKE_LABEL),
              stroke: 'var(--border)',
              labelFill: 'var(--muted-foreground)',
              labelFontSize: 11,
            }),
          ],
          marks: [
            radialArea(rows, {
              angle: 'member',
              radius: 'velocity',
              key: 'member',
              curve: curveLinearClosed,
              fill: COLOR_TAKEN,
              fillOpacity: 0.35,
              stroke: COLOR_TAKEN,
              strokeWidth: 2,
            }),
          ],
        }),
      ],
      scales: { x: null, y: null },
      tooltip: {
        use: tooltip,
        items: [
          { field: 'member', label: 'Member' },
          {
            field: 'velocity',
            label: 'Velocity',
            text: (point) => formatPercent(point.datum.velocity),
          },
        ],
      },
    })
  }, [workingMembers])

  const plannedVsAdhoc = useMemo(() => {
    const rows = workingMembers.flatMap((member) => [
      { member: member.name, work: 'Planned', points: member.planned_points },
      { member: member.name, work: 'Adhoc', points: member.adhoc_points },
    ])
    return defineChart({
      marks: [
        barX(rows, {
          x: 'points',
          y: 'member',
          color: 'work',
          layout: stack({ order: ['Planned', 'Adhoc'] }),
        }),
      ],
      scales: {
        x: { scale: scaleLinear, nice: true, grid: true, axis: { label: 'Points' } },
        y: { scale: () => scaleBand<string>().padding(0.2) },
      },
      color: {
        domain: ['Planned', 'Adhoc'],
        range: [COLOR_TAKEN, COLOR_CAPACITY],
        legend: colorLegend({ label: 'Work type' }),
      },
      tooltip,
    })
  }, [workingMembers])

  if (counted.length === 0) {
    return <p className="text-sm text-muted-foreground">No members with cycle data yet.</p>
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Capacity vs points taken</CardTitle>
          <CardDescription>Dotted = {formatPoints(fullCapacityPoints)} pts.</CardDescription>
        </CardHeader>
        <CardContent>
          <Chart
            definition={takenVsCapacity}
            height={memberChartHeight}
            ariaLabel="Points taken versus capacity by member"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Velocity by person</CardTitle>
          <CardDescription>Radius is done / expected; 100% is on pace.</CardDescription>
        </CardHeader>
        <CardContent>
          {workingMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No estimated points in this cycle yet.</p>
          ) : (
            <Chart
              definition={velocity}
              height={memberChartHeight}
              ariaLabel="Velocity by person"
            />
          )}
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Planned vs adhoc points</CardTitle>
          <CardDescription>Adhoc is work attached after the first day.</CardDescription>
        </CardHeader>
        <CardContent>
          {workingMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No estimated points in this cycle yet.</p>
          ) : (
            <Chart
              definition={plannedVsAdhoc}
              height={chartHeight(workingMembers.length, { perRow: 34, padding: 56 })}
              ariaLabel="Planned versus adhoc points by member"
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
