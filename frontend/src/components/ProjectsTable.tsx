import { createColumnHelper } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { formatMoney, formatPoints } from '../lib/format'
import { badgeVariantForState } from '../lib/issueState'
import { formatProjectState } from '../lib/projectState'
import { appTableFeatures } from '../lib/table'
import type { ProjectOut } from '../types'
import { DataTable, type AppColumnDef } from './DataTable'

const helper = createColumnHelper<typeof appTableFeatures, ProjectOut>()

const columns: AppColumnDef<ProjectOut>[] = [
  helper.accessor('name', {
    header: 'Project',
    cell: (ctx) => <span className="font-medium">{ctx.getValue()}</span>,
  }),
  helper.accessor('state', {
    header: 'State',
    cell: (ctx) => {
      const value = ctx.getValue()
      if (!value) return <span className="text-muted-foreground">{formatProjectState(value)}</span>
      return <Badge variant={badgeVariantForState(value)}>{formatProjectState(value)}</Badge>
    },
  }),
  helper.accessor('issue_count', {
    header: 'Issues',
    cell: (ctx) => <span className="tabular-nums">{ctx.getValue()}</span>,
  }),
  helper.accessor('points', {
    header: 'Points',
    cell: (ctx) => <span className="tabular-nums">{formatPoints(ctx.getValue())}</span>,
  }),
  helper.accessor('done_points', {
    header: 'Done',
    cell: (ctx) => <span className="tabular-nums">{formatPoints(ctx.getValue())}</span>,
  }),
  helper.accessor((row) => row.cost, {
    id: 'cost',
    header: 'Cost',
    cell: (ctx) => (
      <span className="tabular-nums">
        {formatMoney(ctx.getValue(), ctx.row.original.currency)}
      </span>
    ),
  }),
]

export function ProjectsTable({
  projects,
  selectedProjectId,
  onSelect,
  emptyMessage = 'No projects stored for this team yet. Refresh to download them from Linear.',
}: {
  projects: ProjectOut[]
  selectedProjectId: number | null
  onSelect: (project: ProjectOut) => void
  emptyMessage?: string
}) {
  return (
    <DataTable
      columns={columns}
      data={projects}
      emptyMessage={emptyMessage}
      onRowClick={onSelect}
      isRowSelected={(row) => row.id === selectedProjectId}
    />
  )
}
