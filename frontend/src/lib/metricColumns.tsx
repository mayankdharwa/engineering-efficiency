import { createColumnHelper } from '@tanstack/react-table'
import { AvailablePointsCell } from '../components/AvailablePointsCell'
import { BandwidthCell, type RatioTone } from '../components/BandwidthCell'
import type { AppColumnDef } from '../components/DataTable'
import { formatPoints } from './format'
import { appTableFeatures } from './table'
import type { PointMetrics } from '../types'

/** Velocity tone: orange above 100%, red below 90%, otherwise neutral. */
const velocityTone: RatioTone = (displayed) => {
  if (displayed === null) return 'text-muted-foreground'
  if (displayed > 100) return 'text-orange-600 dark:text-orange-400'
  if (displayed < 90) return 'text-destructive'
  return 'text-foreground'
}

/**
 * Shared bandwidth / available / velocity / adhoc / planning columns.
 * First-column(s) stay per-table.
 */
export function createSharedMetricColumns<T extends PointMetrics>(
  pointsPerDay: number,
): AppColumnDef<T>[] {
  const helper = createColumnHelper<typeof appTableFeatures, T>()
  return [
    helper.accessor((row) => row.bandwidth_efficiency, {
      id: 'bandwidth_efficiency',
      header: 'Bandwidth Efficiency',
      cell: (ctx) => {
        const row = ctx.row.original
        return (
          <BandwidthCell
            ratio={row.bandwidth_efficiency}
            detail={`${formatPoints(row.taken_points)}/${formatPoints(row.capacity_points)}`}
          />
        )
      },
    }),
    helper.accessor((row) => row.capacity_points - row.taken_points, {
      id: 'available_points',
      header: 'Available Points',
      cell: (ctx) => (
        <AvailablePointsCell available={ctx.getValue()} pointsPerDay={pointsPerDay} />
      ),
    }),
    helper.accessor((row) => row.velocity, {
      id: 'velocity',
      header: 'Velocity',
      cell: (ctx) => {
        const row = ctx.row.original
        return (
          <BandwidthCell
            ratio={row.velocity}
            tone={velocityTone}
            detail={`${formatPoints(row.done_points)}/${formatPoints(row.expected_points)}`}
          />
        )
      },
    }),
    helper.accessor((row) => row.adhoc_points, {
      id: 'adhoc_points',
      header: 'Adhoc Points',
      cell: (ctx) => <span className="tabular-nums">{formatPoints(ctx.getValue())}</span>,
    }),
    helper.accessor((row) => row.planning_efficiency, {
      id: 'planning_efficiency',
      header: 'Planning Efficiency',
      cell: (ctx) => {
        const row = ctx.row.original
        return (
          <BandwidthCell
            ratio={row.planning_efficiency}
            detail={`${formatPoints(row.planned_points)}/${formatPoints(row.taken_points)}`}
          />
        )
      },
    }),
  ]
}
