import { createColumnHelper } from '@tanstack/react-table'
import { AvailablePointsCell } from '../components/AvailablePointsCell'
import { BandwidthCell } from '../components/BandwidthCell'
import type { AppColumnDef } from '../components/DataTable'
import { PercentCell } from '../components/PercentCell'
import { formatPoints } from './format'
import { appTableFeatures } from './table'
import type { PointMetrics } from '../types'

/**
 * Shared bandwidth / available / done / adhoc / planning / velocity columns.
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
            taken={row.taken_points}
            capacity={row.capacity_points}
            ratio={row.bandwidth_efficiency}
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
    helper.accessor((row) => row.done_points, {
      id: 'done_points',
      header: 'Completed Points',
      cell: (ctx) => <span className="tabular-nums">{formatPoints(ctx.getValue())}</span>,
    }),
    helper.accessor((row) => row.adhoc_points, {
      id: 'adhoc_points',
      header: 'Adhoc Points',
      cell: (ctx) => <span className="tabular-nums">{formatPoints(ctx.getValue())}</span>,
    }),
    helper.accessor((row) => row.planning_efficiency, {
      id: 'planning_efficiency',
      header: 'Planning Efficiency',
      cell: (ctx) => <PercentCell value={ctx.getValue()} />,
    }),
    helper.accessor((row) => row.velocity, {
      id: 'velocity',
      header: 'Velocity',
      cell: (ctx) => <PercentCell value={ctx.getValue()} />,
    }),
  ]
}
