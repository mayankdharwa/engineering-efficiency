import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '../api'
import { useTimezone } from '../hooks/useAppSettings'
import { formatDateTime } from '../lib/format'

interface Feedback {
  type: 'success' | 'error'
  message: string
}

export function LinearConnectionPanel() {
  const queryClient = useQueryClient()
  const timezone = useTimezone()
  const [apiKey, setApiKey] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const configQuery = useQuery({ queryKey: ['config'], queryFn: api.getConfig })

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

  const config = configQuery.data

  return (
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
        {feedback && (
          <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'}>
            <AlertDescription>{feedback.message}</AlertDescription>
          </Alert>
        )}
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
  )
}
