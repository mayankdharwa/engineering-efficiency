import { barX, colorLegend, defineChart, ruleX, stack, text } from '@tanstack/charts'
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
import { formatPercent } from '../lib/format'
import type { MemberMetricsOut } from '../types'

// Theme-driven colors: charts follow the shadcn preset (light/dark aware).
// A shared neutral/primary pair is reused across charts: neutral is the base
// (capacity / adhoc) and primary is the filled work (taken / planned).
const COLOR_TAKEN = 'var(--primary)'
const COLOR_CAPACITY = 'var(--muted-foreground)'

/** Bars above this are truncated just short of it, marked with a chevron. */
const MAX_VELOCITY = 1.2
/** Where a truncated bar stops, leaving the 120% guide line visible. */
const TRUNCATED_VELOCITY = 1.17

function chartHeight(count: number): number {
  return Math.max(160, count * 34 + 56)
}

const percentFormat = (value: number) => formatPercent(value)

interface MetricChartsProps {
  members: MemberMetricsOut[]
}

/**
 * The three core cycle charts. Each definition is memoized against the data it
 * captures (definition identity is the chart's update boundary).
 */
export function MetricCharts({ members }: MetricChartsProps) {
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
  }, [counted])

  const velocity = useMemo(() => {
    const rows = workingMembers.map((member) => {
      const raw = member.velocity ?? 0
      const truncated = raw > MAX_VELOCITY
      return {
        member: member.name,
        // Truncated bars stop short of the 120% guide line; the chevron marks
        // that the real value continues beyond it.
        value: truncated ? TRUNCATED_VELOCITY : raw,
        actual: raw,
        truncated,
      }
    })
    const overflow = rows.filter((row) => row.truncated)
    const hasOverflow = overflow.length > 0
    const xMax = hasOverflow
      ? MAX_VELOCITY
      : Math.max(1, ...rows.map((row) => row.value))
    return defineChart({
      marks: [
        barX(rows, { x: 'value', y: 'member', fill: COLOR_TAKEN }),
        ruleX([1]),
        // Dotted 85% threshold reference.
        ruleX([0.85], { stroke: COLOR_CAPACITY, strokeDasharray: '2 3' }),
        text(overflow, {
          x: () => TRUNCATED_VELOCITY,
          y: 'member',
          text: () => '»',
          anchor: 'start',
          dx: 4,
          fill: COLOR_TAKEN,
          fontSize: 15,
          fontWeight: 700,
        }),
      ],
      scales: {
        x: {
          scale: scaleLinear().domain([0, xMax]).clamp(true),
          nice: true,
          grid: true,
          axis: { label: 'Velocity (done / expected)', ticks: { format: percentFormat } },
        },
        y: { scale: () => scaleBand<string>().padding(0.2) },
      },
      margin: hasOverflow ? { right: 20 } : undefined,
      clip: false,
      tooltip: {
        use: tooltip,
        items: [
          { channel: 'y', label: 'Member' },
          {
            field: 'actual',
            label: 'Velocity',
            text: (point) => formatPercent(point.datum.actual),
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
          <CardDescription>
            Capacity is the full bar; points taken fill it from the left.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Chart
            definition={takenVsCapacity}
            height={chartHeight(counted.length)}
            ariaLabel="Points taken versus capacity by member"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Velocity by person</CardTitle>
          <CardDescription>
            Done ÷ expected-to-date · solid = 100% (on pace) · dotted = 85% · over 120% is
            truncated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workingMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No estimated points in this cycle yet.</p>
          ) : (
            <Chart
              definition={velocity}
              height={chartHeight(workingMembers.length)}
              ariaLabel="Velocity by person"
            />
          )}
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Planned vs adhoc points</CardTitle>
          <CardDescription>Adhoc = attached after the cycle&apos;s first day.</CardDescription>
        </CardHeader>
        <CardContent>
          {workingMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No estimated points in this cycle yet.</p>
          ) : (
            <Chart
              definition={plannedVsAdhoc}
              height={chartHeight(workingMembers.length)}
              ariaLabel="Planned versus adhoc points by member"
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
