import { createColumnHelper } from '@tanstack/react-table'
import { useMemo } from 'react'
import { selectGroups } from '../lib/groups'
import { createSharedMetricColumns } from '../lib/metricColumns'
import { appTableFeatures } from '../lib/table'
import type { GroupMetricsOut } from '../types'
import { DataTable, type AppColumnDef } from './DataTable'
import { GroupBadge } from './GroupBadge'

const helper = createColumnHelper<typeof appTableFeatures, GroupMetricsOut>()

const leadingColumns: AppColumnDef<GroupMetricsOut>[] = [
  helper.accessor('label', {
    header: 'Group',
    cell: (ctx) => {
      const row = ctx.row.original
      if (row.group_id === null) {
        return <span className="text-muted-foreground">{row.label}</span>
      }
      return <GroupBadge name={row.label} color={row.color} />
    },
  }),
  helper.accessor('members', {
    header: 'People',
    cell: (ctx) => <span className="tabular-nums">{ctx.getValue()}</span>,
  }),
]

interface GroupMetricsTableProps {
  groups: GroupMetricsOut[]
  selected: Set<string>
  pointsPerDay: number
}

export function GroupMetricsTable({ groups, selected, pointsPerDay }: GroupMetricsTableProps) {
  const columns = useMemo(
    () => [...leadingColumns, ...createSharedMetricColumns<GroupMetricsOut>(pointsPerDay)],
    [pointsPerDay],
  )

  return (
    <DataTable
      columns={columns}
      data={selectGroups(groups, selected)}
      centerExcept={['label']}
      emptyMessage="Add groups and assign members in Configuration to see group totals."
    />
  )
}
