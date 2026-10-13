import { createColumnHelper } from '@tanstack/react-table'
import { EllipsisVerticalIcon } from 'lucide-react'
import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatMoney, formatPoints } from '../lib/format'
import { badgeVariantForState } from '../lib/issueState'
import { EXCLUDED_PROJECT_STATE, formatProjectState } from '../lib/projectState'
import { appTableFeatures } from '../lib/table'
import type { ProjectOut } from '../types'
import { DataTable, type AppColumnDef } from './DataTable'

const helper = createColumnHelper<typeof appTableFeatures, ProjectOut>()

function ProjectRowMenu({
  excluded,
  onToggleExcluded,
}: {
  excluded: boolean
  onToggleExcluded: () => void
}) {
  return (
    <div
      className="shrink-0"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          className={buttonVariants({ variant: 'ghost', size: 'icon-xs' })}
          aria-label="Project actions"
        >
          <EllipsisVerticalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={onToggleExcluded}>
            {excluded ? 'Include' : 'Exclude'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function createColumns(
  onToggleExcluded: (project: ProjectOut) => void,
): AppColumnDef<ProjectOut>[] {
  return [
    helper.accessor('name', {
      header: 'Project',
      meta: { className: 'w-[33%] max-w-[33%] overflow-hidden' },
      cell: (ctx) => {
        const project = ctx.row.original
        return (
          <div className="flex min-w-0 items-center gap-1">
            <ProjectRowMenu
              excluded={project.excluded}
              onToggleExcluded={() => onToggleExcluded(project)}
            />
            <span className="min-w-0 flex-1 truncate font-medium" title={ctx.getValue()}>
              {ctx.getValue()}
            </span>
          </div>
        )
      },
    }),
    helper.accessor('state', {
      header: 'State',
      cell: (ctx) => {
        const project = ctx.row.original
        const value = project.excluded ? EXCLUDED_PROJECT_STATE : ctx.getValue()
        if (!value) {
          return <span className="text-muted-foreground">{formatProjectState(value)}</span>
        }
        return <Badge variant={badgeVariantForState(value)}>{formatProjectState(value)}</Badge>
      },
    }),
    helper.accessor('issue_count', {
      header: 'Issues',
      cell: (ctx) => <span className="tabular-nums">{ctx.getValue()}</span>,
    }),
    helper.accessor('unestimated_issues', {
      header: 'Unestimated Issues',
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
}

export function ProjectsTable({
  projects,
  selectedProjectId,
  onSelect,
  onToggleExcluded,
  emptyMessage = 'Refresh this team to load projects.',
}: {
  projects: ProjectOut[]
  selectedProjectId: number | null
  onSelect: (project: ProjectOut) => void
  onToggleExcluded: (project: ProjectOut) => void
  emptyMessage?: string
}) {
  const columns = useMemo(() => createColumns(onToggleExcluded), [onToggleExcluded])
  return (
    <DataTable
      columns={columns}
      data={projects}
      centerExcept={['name']}
      emptyMessage={emptyMessage}
      onRowClick={onSelect}
      isRowSelected={(row) => row.id === selectedProjectId}
    />
  )
}
