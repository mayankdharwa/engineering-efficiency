import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
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
import { queryKeys } from '../lib/queryKeys'

export function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const statusQuery = useQuery({
    queryKey: queryKeys.auth,
    queryFn: api.getAuthStatus,
  })
  const setupRequired = statusQuery.data?.setup_required ?? false

  const mutation = useMutation({
    mutationFn: ({ name, secret }: { name: string; secret: string }) =>
      setupRequired ? api.setupAccount(name, secret) : api.login(name, secret),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth })
      await navigate({ to: '/' })
    },
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate({ name: username, secret: password })
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4">
      <div className="mb-6 flex items-center gap-2 text-sm font-semibold">
        <span className="size-5 rounded-md bg-gradient-to-br from-primary to-amber-600" />
        Engineering Efficiency
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="border-b">
          <CardTitle>
            {statusQuery.isLoading
              ? 'Welcome'
              : setupRequired
                ? 'Create your account'
                : 'Sign in'}
          </CardTitle>
          <CardDescription>
            {statusQuery.isLoading
              ? 'Checking whether this dashboard already has an account.'
              : setupRequired
                ? 'This dashboard is open until you create the first account. After that, every page and API requires a login.'
                : 'Sign in to open the dashboard.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statusQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Checking this dashboard…</p>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={setupRequired ? 'new-password' : 'current-password'}
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {setupRequired ? (
                  <p className="text-xs text-muted-foreground">At least 8 characters.</p>
                ) : null}
              </div>
              {mutation.isError ? (
                <p className="text-sm text-destructive" role="alert">
                  {mutation.error instanceof Error
                    ? mutation.error.message
                    : 'Sign in failed.'}
                </p>
              ) : null}
              <Button type="submit" disabled={mutation.isPending || statusQuery.isLoading}>
                {mutation.isPending
                  ? 'Working…'
                  : setupRequired
                    ? 'Create account'
                    : 'Sign in'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
