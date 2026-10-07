import { createColumnHelper } from '@tanstack/react-table'
import { formatPercent, formatPoints } from '../lib/format'
import { appTableFeatures } from '../lib/table'
import type { MemberMetricsOut, RoleFilter } from '../types'
import { DataTable, type AppColumnDef } from './DataTable'
import { PercentCell } from './PercentCell'
import { RoleBadge } from './RoleBadge'

const helper = createColumnHelper<typeof appTableFeatures, MemberMetricsOut>()

function matchesRole(member: MemberMetricsOut, filter: RoleFilter): boolean {
  if (filter === 'all') return true
  return member.role === filter
}

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
    cell: (ctx) => {
      const member = ctx.row.original
      const muted = member.linear_id === null
      return (
        <span className={muted ? 'text-muted-foreground' : 'font-medium'}>{ctx.getValue()}</span>
      )
    },
  }),
  helper.accessor('role', {
    header: 'Role',
    cell: (ctx) => <RoleBadge role={ctx.getValue()} />,
  }),
  helper.accessor('unavailable_days', {
    header: 'Unavailable',
    cell: (ctx) => <span className="tabular-nums">{formatPoints(ctx.getValue())}d</span>,
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
  helper.accessor('adhoc_points', {
    header: 'Adhoc',
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
    cell: (ctx) => <span className="tabular-nums">{formatPercent(ctx.getValue())}</span>,
  }),
]

interface MetricsTableProps {
  members: MemberMetricsOut[]
  role: RoleFilter
}

export function MetricsTable({ members, role }: MetricsTableProps) {
  const filtered = members.filter((member) => isListed(member) && matchesRole(member, role))

  return (
    <DataTable
      columns={columns}
      data={filtered}
      emptyMessage="No member metrics yet. Refresh the team to download its current cycle."
    />
  )
}
