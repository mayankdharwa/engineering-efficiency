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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '../api'
import { CycleSettingsPanel } from '../components/CycleSettingsPanel'
import { MetricSettingsPanel } from '../components/MetricSettingsPanel'
import { TeamsTable } from '../components/TeamsTable'
import { useTimezone } from '../hooks/useAppSettings'
import { formatDateTime } from '../lib/format'

interface Feedback {
  type: 'success' | 'error'
  message: string
}

export function ConfigPage() {
  const queryClient = useQueryClient()
  const timezone = useTimezone()
  const [apiKey, setApiKey] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const configQuery = useQuery({ queryKey: ['config'], queryFn: api.getConfig })
  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: api.listTeams })
  const teams = teamsQuery.data ?? []

  const saveMutation = useMutation({
    mutationFn: (key: string) => api.saveConfig(key),
    onSuccess: (config) => {
      setApiKey('')
      setFeedback({
        type: 'success',
        message: config.organization_name
          ? `Connected to ${config.organization_name}.`
          : 'API key saved.',
      })
      queryClient.invalidateQueries({ queryKey: ['config'] })
    },
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
  })

  const testMutation = useMutation({
    mutationFn: api.testConnection,
    onSuccess: (result) =>
      setFeedback({ type: result.ok ? 'success' : 'error', message: result.message }),
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
  })

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

  const config = configQuery.data
  const refreshingTeamId = refreshMutation.isPending ? (refreshMutation.variables ?? null) : null
  const deletingTeamId = deleteMutation.isPending ? (deleteMutation.variables ?? null) : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Configuration</h1>
        <p className="text-sm text-muted-foreground">
          Connect to Linear and manage the teams and cycle settings stored locally.
        </p>
      </div>

      {feedback && (
        <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Linear connection</CardTitle>
          <CardDescription>
            {config?.configured ? (
              <>
                Connected as <strong>{config.viewer_name ?? 'unknown user'}</strong>
                {config.organization_name ? ` (${config.organization_name})` : ''}. Last updated{' '}
                {formatDateTime(config.updated_at, timezone)}.
              </>
            ) : (
              'Paste a Linear personal API key. It is stored in the local SQLite database only.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          <div className="max-w-md space-y-2">
            <Label htmlFor="linear-api-key">Linear API key</Label>
            <Input
              id="linear-api-key"
              type="password"
              autoComplete="off"
              placeholder={
                config?.configured ? '•••••••• (leave blank to keep current)' : 'lin_api_…'
              }
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={apiKey.trim().length === 0 || saveMutation.isPending}
              onClick={() => saveMutation.mutate(apiKey.trim())}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save & validate'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!config?.configured || testMutation.isPending}
              onClick={() => testMutation.mutate()}
            >
              {testMutation.isPending ? 'Testing…' : 'Test connection'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <MetricSettingsPanel />

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
              variant="outline"
              disabled={!config?.configured || importMutation.isPending}
              onClick={() => importMutation.mutate()}
            >
              {importMutation.isPending ? 'Importing…' : 'Import teams'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <TeamsTable
            teams={teams}
            onRefresh={handleRefresh}
            refreshingTeamId={refreshingTeamId}
            onDelete={handleDelete}
            deletingTeamId={deletingTeamId}
          />
        </CardContent>
      </Card>

      <CycleSettingsPanel />
    </div>
  )
}
