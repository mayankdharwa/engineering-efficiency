import { createColumnHelper } from '@tanstack/react-table'
import { formatPoints } from '../lib/format'
import { appTableFeatures } from '../lib/table'
import type { RoleFilter, RoleMetricsOut } from '../types'
import { DataTable, type AppColumnDef } from './DataTable'
import { PercentCell } from './PercentCell'
import { RoleBadge } from './RoleBadge'

const helper = createColumnHelper<typeof appTableFeatures, RoleMetricsOut>()

const columns: AppColumnDef<RoleMetricsOut>[] = [
  helper.accessor('label', {
    header: 'Role',
    cell: (ctx) => {
      const row = ctx.row.original
      if (row.role === null) {
        return <span className="text-muted-foreground">{row.label}</span>
      }
      return <RoleBadge role={row.role} />
    },
  }),
  helper.accessor('members', {
    header: 'People',
    cell: (ctx) => <span className="tabular-nums">{ctx.getValue()}</span>,
  }),
  helper.accessor('capacity_points', {
    header: 'Capacity',
    cell: (ctx) => <span className="tabular-nums">{formatPoints(ctx.getValue())}</span>,
  }),
  helper.accessor('taken_points', {
    header: 'Taken',
    cell: (ctx) => <span className="tabular-nums">{formatPoints(ctx.getValue())}</span>,
  }),
  helper.accessor('done_points', {
    header: 'Done',
    cell: (ctx) => <span className="tabular-nums">{formatPoints(ctx.getValue())}</span>,
  }),
  helper.accessor('planning_efficiency', {
    header: 'Planning',
    cell: (ctx) => <PercentCell value={ctx.getValue()} />,
  }),
  helper.accessor('velocity', {
    header: 'Velocity',
    cell: (ctx) => <PercentCell value={ctx.getValue()} />,
  }),
  helper.accessor('bandwidth_efficiency', {
    header: 'Bandwidth',
    cell: (ctx) => <PercentCell value={ctx.getValue()} />,
  }),
]

interface RoleMetricsTableProps {
  roles: RoleMetricsOut[]
  role: RoleFilter
}

export function RoleMetricsTable({ roles, role }: RoleMetricsTableProps) {
  const filtered = role === 'all' ? roles : roles.filter((row) => row.role === role)

  return (
    <DataTable
      columns={columns}
      data={filtered}
      emptyMessage="Tag members as DEV or QA in Configuration to see role totals."
    />
  )
}
