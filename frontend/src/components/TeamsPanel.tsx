import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { api } from '../api'
import { notifyError, notifySuccess } from '../lib/notify'
import { invalidateTeamData, queryKeys } from '../lib/queryKeys'
import { TeamsTable } from './TeamsTable'

export function TeamsPanel() {
  const queryClient = useQueryClient()

  const configQuery = useQuery({ queryKey: queryKeys.config, queryFn: api.getConfig })
  const teamsQuery = useQuery({ queryKey: queryKeys.teams, queryFn: api.listTeams })
  const teams = teamsQuery.data ?? []

  const importMutation = useMutation({
    mutationFn: api.importTeams,
    onSuccess: (imported) => {
      notifySuccess(`Imported ${imported.length} team(s) from Linear.`)
      queryClient.invalidateQueries({ queryKey: queryKeys.teams })
    },
    onError: (error: Error) => notifyError(error.message),
  })

  const refreshMutation = useMutation({
    mutationFn: (teamId: number) => api.refreshTeam(teamId),
    onSuccess: (result) => {
      notifySuccess(result.message ?? `Synced ${result.issues_synced} issue(s).`)
      invalidateTeamData(queryClient, result.team_id)
    },
    onError: (error: Error) => notifyError(error.message),
  })

  const handleRefresh = useCallback(
    (teamId: number) => refreshMutation.mutate(teamId),
    [refreshMutation.mutate],
  )

  const deleteMutation = useMutation({
    mutationFn: (teamId: number) => api.deleteTeam(teamId),
    onSuccess: (_result, teamId) => {
      const team = teams.find((candidate) => candidate.id === teamId)
      notifySuccess(team ? `Deleted ${team.name}.` : 'Team deleted.')
      invalidateTeamData(queryClient, teamId, { remove: true })
    },
    onError: (error: Error) => notifyError(error.message),
  })

  const handleDelete = useCallback(
    (teamId: number) => deleteMutation.mutate(teamId),
    [deleteMutation.mutate],
  )

  const refreshingTeamId = refreshMutation.isPending ? (refreshMutation.variables ?? null) : null
  const deletingTeamId = deleteMutation.isPending ? (deleteMutation.variables ?? null) : null

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Teams</CardTitle>
        <CardDescription>
          Import the team list, then refresh a team to load its cycle.
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            disabled={!configQuery.data?.configured || importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            {importMutation.isPending ? 'Importing…' : 'Import teams'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="gap-4">
        <TeamsTable
          teams={teams}
          onRefresh={handleRefresh}
          refreshingTeamId={refreshingTeamId}
          onDelete={handleDelete}
          deletingTeamId={deletingTeamId}
        />
      </CardContent>
    </Card>
  )
}
