import { createColumnHelper } from '@tanstack/react-table'
import { formatPoints } from '../lib/format'
import { filterMembers } from '../lib/groups'
import { appTableFeatures } from '../lib/table'
import type { MemberMetricsOut } from '../types'
import { BandwidthCell } from './BandwidthCell'
import { DataTable, type AppColumnDef } from './DataTable'
import { GroupBadge } from './GroupBadge'
import { PercentCell } from './PercentCell'

const helper = createColumnHelper<typeof appTableFeatures, MemberMetricsOut>()

/**
 * The per-person table lists only people who count toward capacity. The
 * synthetic "Unassigned" aggregate (no Linear id) is always kept.
 */
function isListed(member: MemberMetricsOut): boolean {
  return member.linear_id === null || member.counts_toward_capacity
}

const columns: AppColumnDef<MemberMetricsOut>[] = [
  helper.accessor('name', {
    header: 'Member',
    meta: { className: 'w-px whitespace-nowrap' },
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
    meta: { className: 'w-px whitespace-nowrap' },
    cell: (ctx) => <span className="tabular-nums">{formatPoints(ctx.getValue())}d</span>,
  }),
  helper.accessor('bandwidth_efficiency', {
    header: 'Bandwidth Efficiency',
    cell: (ctx) => {
      const member = ctx.row.original
      return (
        <BandwidthCell
          taken={member.taken_points}
          capacity={member.capacity_points}
          ratio={member.bandwidth_efficiency}
        />
      )
    },
  }),
  helper.accessor((row) => row.capacity_points - row.taken_points, {
    id: 'available_points',
    header: 'Available Points',
    cell: (ctx) => {
      const available = ctx.getValue()
      if (available <= 0) {
        return <span className="text-muted-foreground">—</span>
      }
      return (
        <span className="tabular-nums">
          <span className="font-bold">{formatPoints(available)}</span>{' '}
          <span className="text-muted-foreground">
            (~{formatPoints(available / 2)}d)
          </span>
        </span>
      )
    },
  }),
  helper.accessor('done_points', {
    header: 'Completed Points',
    cell: (ctx) => <span className="tabular-nums">{formatPoints(ctx.getValue())}</span>,
  }),
  helper.accessor('adhoc_points', {
    header: 'Adhoc Points',
    cell: (ctx) => <span className="tabular-nums">{formatPoints(ctx.getValue())}</span>,
  }),
  helper.accessor('planning_efficiency', {
    header: 'Planning Efficiency',
    cell: (ctx) => <PercentCell value={ctx.getValue()} />,
  }),
  helper.accessor('velocity', {
    header: 'Velocity',
    cell: (ctx) => <PercentCell value={ctx.getValue()} />,
  }),
]

interface MetricsTableProps {
  members: MemberMetricsOut[]
  selected: Set<string>
}

export function MetricsTable({ members, selected }: MetricsTableProps) {
  const filtered = filterMembers(members, selected).filter(isListed)

  return (
    <DataTable
      columns={columns}
      data={filtered}
      centerExcept={['name']}
      emptyMessage="No member metrics yet. Refresh the team to download its current cycle."
    />
  )
}
