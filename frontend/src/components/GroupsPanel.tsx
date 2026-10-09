import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '../api'
import { useConfigTeam } from '../hooks/useConfigTeam'
import type { GroupOut } from '../types'
import { TeamSelect } from './TeamSelect'

interface Feedback {
  type: 'success' | 'error'
  message: string
}

/** Add, rename and delete a team's member groups. */
export function GroupsPanel() {
  const queryClient = useQueryClient()
  const { teamId } = useConfigTeam()

  const groupsQuery = useQuery({
    queryKey: ['groups', teamId],
    queryFn: () => api.listGroups(teamId as number),
    enabled: teamId !== null,
  })
  const groups: GroupOut[] = groupsQuery.data ?? []

  const [groupDrafts, setGroupDrafts] = useState<Record<number, string>>({})
  const [newGroupName, setNewGroupName] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  useEffect(() => {
    if (!groupsQuery.data) return
    setGroupDrafts(
      Object.fromEntries(groupsQuery.data.map((group) => [group.id, group.name])),
    )
  }, [groupsQuery.data])

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['groups', teamId] })
    queryClient.invalidateQueries({ queryKey: ['cycle', teamId] })
    queryClient.invalidateQueries({ queryKey: ['stats', teamId] })
  }

  const createGroup = useMutation({
    mutationFn: (name: string) => api.createGroup(teamId as number, name),
    onSuccess: (group) => {
      setNewGroupName('')
      setFeedback({ type: 'success', message: `Added group '${group.name}'.` })
      invalidate()
    },
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
  })

  const renameGroup = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.renameGroup(teamId as number, id, name),
    onSuccess: (group) => {
      setFeedback({ type: 'success', message: `Renamed group to '${group.name}'.` })
      invalidate()
    },
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
  })

  const deleteGroup = useMutation({
    mutationFn: (id: number) => api.deleteGroup(teamId as number, id),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Group deleted; members were unassigned.' })
      invalidate()
    },
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
  })

  return (
    <div className="flex flex-col gap-6">
      <TeamSelect />
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Groups</CardTitle>
          <CardDescription>
            Add any number of groups, then assign each person to one of them in Team Configuration.
            Group totals drive the dashboard&apos;s group breakdown and filter.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          {feedback && (
            <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'}>
              <AlertDescription>{feedback.message}</AlertDescription>
            </Alert>
          )}

          {teamId === null ? null : groupsQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-full max-w-md" />
              <Skeleton className="h-8 w-full max-w-md" />
            </div>
          ) : groupsQuery.isError ? (
            <p className="text-sm text-destructive">{groupsQuery.error.message}</p>
          ) : (
            <div className="space-y-3">
              {groups.length > 0 && (
                <div className="space-y-2">
                  {groups.map((group) => {
                    const draft = groupDrafts[group.id] ?? group.name
                    const changed = draft.trim() !== group.name
                    return (
                      <div key={group.id} className="flex flex-wrap items-center gap-2">
                        <Input
                          className="h-8 max-w-xs"
                          value={draft}
                          aria-label={`Name for group ${group.name}`}
                          onChange={(event) =>
                            setGroupDrafts((prev) => ({
                              ...prev,
                              [group.id]: event.target.value,
                            }))
                          }
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!changed || draft.trim().length === 0 || renameGroup.isPending}
                          onClick={() => renameGroup.mutate({ id: group.id, name: draft.trim() })}
                        >
                          Rename
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={deleteGroup.isPending}
                          onClick={() => deleteGroup.mutate(group.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="h-8 max-w-xs"
                  placeholder="New group name"
                  value={newGroupName}
                  aria-label="New group name"
                  onChange={(event) => setNewGroupName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && newGroupName.trim().length > 0) {
                      event.preventDefault()
                      createGroup.mutate(newGroupName.trim())
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={newGroupName.trim().length === 0 || createGroup.isPending}
                  onClick={() => createGroup.mutate(newGroupName.trim())}
                >
                  Add group
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
