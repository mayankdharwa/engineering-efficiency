import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { TeamsTable } from './TeamsTable'

interface Feedback {
  type: 'success' | 'error'
  message: string
}

export function TeamsPanel() {
  const queryClient = useQueryClient()
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const configQuery = useQuery({ queryKey: ['config'], queryFn: api.getConfig })
  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: api.listTeams })
  const teams = teamsQuery.data ?? []

  const importMutation = useMutation({
    mutationFn: api.importTeams,
    onSuccess: (imported) => {
      setFeedback({ type: 'success', message: `Imported ${imported.length} team(s) from Linear.` })
      queryClient.invalidateQueries({ queryKey: ['teams'] })
    },
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
  })

  const refreshMutation = useMutation({
    mutationFn: (teamId: number) => api.refreshTeam(teamId),
    onSuccess: (result) => {
      setFeedback({
        type: 'success',
        message: result.message ?? `Synced ${result.issues_synced} issue(s).`,
      })
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['issues', result.team_id] })
      queryClient.invalidateQueries({ queryKey: ['cycle', result.team_id] })
      queryClient.invalidateQueries({ queryKey: ['stats', result.team_id] })
    },
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
  })

  const handleRefresh = useCallback(
    (teamId: number) => refreshMutation.mutate(teamId),
    [refreshMutation.mutate],
  )

  const deleteMutation = useMutation({
    mutationFn: (teamId: number) => api.deleteTeam(teamId),
    onSuccess: (_result, teamId) => {
      const team = teams.find((candidate) => candidate.id === teamId)
      setFeedback({
        type: 'success',
        message: team ? `Deleted ${team.name}.` : 'Team deleted.',
      })
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.removeQueries({ queryKey: ['issues', teamId] })
      queryClient.removeQueries({ queryKey: ['cycle', teamId] })
      queryClient.removeQueries({ queryKey: ['stats', teamId] })
    },
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
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
          Importing fetches the team list. Use <strong>Refresh</strong> to download a team&apos;s
          current cycle and membership, or <strong>Delete</strong> to remove a team from this
          dashboard.
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
        {feedback && (
          <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'}>
            <AlertDescription>{feedback.message}</AlertDescription>
          </Alert>
        )}
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
