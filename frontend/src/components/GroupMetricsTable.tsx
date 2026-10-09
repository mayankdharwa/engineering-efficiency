import { createColumnHelper } from '@tanstack/react-table'
import { selectGroups } from '../lib/groups'
import { formatPoints } from '../lib/format'
import { appTableFeatures } from '../lib/table'
import type { GroupMetricsOut } from '../types'
import { DataTable, type AppColumnDef } from './DataTable'
import { GroupBadge } from './GroupBadge'
import { PercentCell } from './PercentCell'

const helper = createColumnHelper<typeof appTableFeatures, GroupMetricsOut>()

const columns: AppColumnDef<GroupMetricsOut>[] = [
  helper.accessor('label', {
    header: 'Group',
    cell: (ctx) => {
      const row = ctx.row.original
      if (row.group_id === null) {
        return <span className="text-muted-foreground">{row.label}</span>
      }
      return <GroupBadge name={row.label} />
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

interface GroupMetricsTableProps {
  groups: GroupMetricsOut[]
  selected: Set<string>
}

export function GroupMetricsTable({ groups, selected }: GroupMetricsTableProps) {
  return (
    <DataTable
      columns={columns}
      data={selectGroups(groups, selected)}
      emptyMessage="Add groups and assign members in Configuration to see group totals."
    />
  )
}
