import { barX, colorLegend, defineChart, ruleX, stack } from '@tanstack/charts'
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
  const capacityMembers = members.filter((member) => member.linear_id !== null)
  const workingMembers = members.filter((member) => member.taken_points > 0)

  const takenVsCapacity = useMemo(() => {
    const rows = members.filter((member) => member.linear_id !== null)
    const capacityRows = rows.map((member) => ({
      member: member.name,
      points: member.capacity_points,
    }))
    const takenRows = rows.map((member) => ({
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
        domain: ['Capacity', 'Taken'],
        range: [COLOR_CAPACITY, COLOR_TAKEN],
        legend: colorLegend({ label: 'Points' }),
      },
      tooltip,
    })
  }, [members])

  const velocity = useMemo(() => {
    const rows = members
      .filter((member) => member.taken_points > 0)
      .map((member) => ({ member: member.name, value: member.velocity ?? 0 }))
    return defineChart({
      marks: [barX(rows, { x: 'value', y: 'member', fill: COLOR_TAKEN }), ruleX([1])],
      scales: {
        x: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: { label: 'Velocity (done / expected)', ticks: { format: percentFormat } },
        },
        y: { scale: () => scaleBand<string>().padding(0.2) },
      },
      tooltip,
    })
  }, [members])

  const plannedVsAdhoc = useMemo(() => {
    const rows = members
      .filter((member) => member.taken_points > 0)
      .flatMap((member) => [
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
  }, [members])

  if (capacityMembers.length === 0) {
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
            height={chartHeight(capacityMembers.length)}
            ariaLabel="Points taken versus capacity by member"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Velocity by person</CardTitle>
          <CardDescription>Done ÷ expected-to-date · 100% = on pace.</CardDescription>
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
