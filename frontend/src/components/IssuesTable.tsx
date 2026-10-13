import { createColumnHelper } from '@tanstack/react-table'
import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { useTimezone } from '../hooks/useAppSettings'
import { formatDateTime, formatPoints } from '../lib/format'
import { badgeVariantForState, isCompletedState } from '../lib/issueState'
import { appTableFeatures } from '../lib/table'
import type { IssueOut } from '../types'
import { DataTable, type AppColumnDef } from './DataTable'

export type IssueTableRow = Pick<
  IssueOut,
  | 'identifier'
  | 'title'
  | 'state_name'
  | 'state_type'
  | 'estimate'
  | 'assignee_name'
  | 'created_at'
  | 'completed_at'
> & {
  project_name?: string | null
}

const helper = createColumnHelper<typeof appTableFeatures, IssueTableRow>()

const MAX_LABEL_LENGTH = 50

/** Trim long text to `max` characters, appending an ellipsis when clipped. */
function truncate(value: string | null, max = MAX_LABEL_LENGTH): string {
  if (!value) return ''
  return value.length > max ? `${value.slice(0, max)}...` : value
}

const columns = (timezone: string, showProject: boolean): AppColumnDef<IssueTableRow>[] => [
  helper.accessor('identifier', {
    header: 'ID',
    cell: (ctx) => (
      <span className="font-mono text-xs text-muted-foreground">{ctx.getValue()}</span>
    ),
  }),
  helper.accessor('title', {
    header: 'Title',
    cell: (ctx) => {
      const value = ctx.getValue()
      return <span title={value}>{truncate(value)}</span>
    },
  }),
  helper.accessor('state_name', {
    header: 'State',
    cell: (ctx) =>
      ctx.getValue() ? (
        <Badge variant={badgeVariantForState(ctx.row.original.state_type)}>{ctx.getValue()}</Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  }),
  helper.accessor('assignee_name', {
    header: 'Assignee',
    cell: (ctx) => ctx.getValue() ?? <span className="text-muted-foreground">Unassigned</span>,
  }),
  ...(showProject
    ? [
        helper.accessor('project_name', {
          header: 'Project',
          cell: (ctx) => {
            const value = ctx.getValue()
            if (!value) return <span className="text-muted-foreground">—</span>
            return <span title={value}>{truncate(value)}</span>
          },
        }),
      ]
    : []),
  helper.accessor('estimate', {
    header: 'Estimate',
    cell: (ctx) => <span className="tabular-nums">{formatPoints(ctx.getValue())}</span>,
  }),
  helper.accessor('created_at', {
    header: 'Created',
    cell: (ctx) => (
      <span className="text-muted-foreground">{formatDateTime(ctx.getValue(), timezone)}</span>
    ),
  }),
  helper.accessor('completed_at', {
    header: 'Completed',
    cell: (ctx) => (
      <span className="text-muted-foreground">{formatDateTime(ctx.getValue(), timezone)}</span>
    ),
  }),
]

interface IssuesTableProps {
  issues: IssueTableRow[]
  /** When false, issues in a completed state are hidden. */
  showDone: boolean
  showProject?: boolean
  emptyMessage?: string
}

export function IssuesTable({
  issues,
  showDone,
  showProject = true,
  emptyMessage,
}: IssuesTableProps) {
  const timezone = useTimezone()
  const tableColumns = useMemo(() => columns(timezone, showProject), [timezone, showProject])
  const visible = showDone
    ? issues
    : issues.filter((issue) => !isCompletedState(issue.state_type))

  return (
    <DataTable
      columns={tableColumns}
      data={visible}
      emptyMessage={
        emptyMessage ??
        (issues.length === 0
          ? 'Refresh this team to load issues.'
          : 'No issues match the current filter.')
      }
    />
  )
}
