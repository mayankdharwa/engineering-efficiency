import { createColumnHelper } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { formatRelative } from '../lib/format'
import { appTableFeatures } from '../lib/table'
import type { TeamOut } from '../types'
import { DataTable, type AppColumnDef } from './DataTable'

const helper = createColumnHelper<typeof appTableFeatures, TeamOut>()

interface TeamsTableProps {
  teams: TeamOut[]
  onRefresh: (teamId: number) => void
  refreshingTeamId: number | null
  onDelete: (teamId: number) => void
  deletingTeamId: number | null
}

export function TeamsTable({
  teams,
  onRefresh,
  refreshingTeamId,
  onDelete,
  deletingTeamId,
}: TeamsTableProps) {
  const [pendingDelete, setPendingDelete] = useState<TeamOut | null>(null)

  const columns = useMemo<AppColumnDef<TeamOut>[]>(
    () => [
      helper.accessor('key', {
        header: 'Key',
        cell: (ctx) => <span className="font-mono text-xs">{ctx.getValue()}</span>,
      }),
      helper.accessor('name', { header: 'Name' }),
      helper.accessor('issue_count', {
        header: 'Issues',
        cell: (ctx) => <span className="tabular-nums">{ctx.getValue()}</span>,
      }),
      helper.accessor('last_synced_at', {
        header: 'Last synced',
        cell: (ctx) => <span className="text-muted-foreground">{formatRelative(ctx.getValue())}</span>,
      }),
      helper.display({
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        cell: (ctx) => {
          const team = ctx.row.original
          const isRefreshing = refreshingTeamId === team.id
          const isDeleting = deletingTeamId === team.id
          const isBusy = isRefreshing || isDeleting
          return (
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isBusy}
                onClick={() => onRefresh(team.id)}
              >
                {isRefreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={isBusy}
                onClick={() => setPendingDelete(team)}
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          )
        },
      }),
    ],
    [onRefresh, refreshingTeamId, deletingTeamId],
  )

  return (
    <>
      <DataTable
        columns={columns}
        data={teams}
        emptyMessage="No teams yet. Import them from Linear above."
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <strong>{pendingDelete?.name}</strong> and all of its locally stored
              issues, cycle settings and members. Linear is not affected, but the team&apos;s
              configuration here will be lost until it is re-imported and refreshed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id)
                setPendingDelete(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
