import { createColumnHelper } from '@tanstack/react-table'
import { useMemo } from 'react'
import { formatPoints } from '../lib/format'
import { filterMembers } from '../lib/groups'
import { createSharedMetricColumns } from '../lib/metricColumns'
import { appTableFeatures } from '../lib/table'
import type { MemberMetricsOut } from '../types'
import { DataTable, type AppColumnDef } from './DataTable'
import { GroupBadge } from './GroupBadge'

const helper = createColumnHelper<typeof appTableFeatures, MemberMetricsOut>()

/**
 * The per-person table lists only people who count toward capacity. The
 * synthetic "Unassigned" aggregate (no Linear id) is always kept.
 */
function isListed(member: MemberMetricsOut): boolean {
  return member.linear_id === null || member.counts_toward_capacity
}

const leadingColumns: AppColumnDef<MemberMetricsOut>[] = [
  helper.accessor('name', {
    header: 'Member',
    cell: (ctx) => {
      const member = ctx.row.original
      const muted = member.linear_id === null
      return (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span className={muted ? 'text-muted-foreground' : 'font-medium'}>
            {ctx.getValue()}
          </span>
          <GroupBadge name={member.group_name} color={member.group_color} />
        </span>
      )
    },
  }),
  helper.accessor('unavailable_days', {
    header: 'Unavailable',
    cell: (ctx) => {
      const days = ctx.getValue()
      if (days <= 0) return <span className="text-muted-foreground">—</span>
      return <span className="tabular-nums">{formatPoints(days)}d</span>
    },
  }),
]

interface MetricsTableProps {
  members: MemberMetricsOut[]
  selected: Set<string>
  pointsPerDay: number
}

export function MetricsTable({ members, selected, pointsPerDay }: MetricsTableProps) {
  const filtered = filterMembers(members, selected).filter(isListed)
  const columns = useMemo(
    () => [...leadingColumns, ...createSharedMetricColumns<MemberMetricsOut>(pointsPerDay)],
    [pointsPerDay],
  )

  return (
    <DataTable
      columns={columns}
      data={filtered}
      centerExcept={['name']}
      emptyMessage="No member metrics yet. Refresh the team to download its current cycle."
    />
  )
}
