import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
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
import { isHexColor, parseHexColor } from '../lib/color'
import { notifyError, notifySuccess } from '../lib/notify'
import { invalidateTeamData, queryKeys } from '../lib/queryKeys'
import type { GroupOut } from '../types'
import { GroupBadge } from './GroupBadge'
import { QueryPanelBody } from './QueryPanelBody'
import { TeamSelect } from './TeamSelect'

const DEFAULT_GROUP_COLORS = [
  '#d97706',
  '#2563eb',
  '#059669',
  '#dc2626',
  '#7c3aed',
  '#db2777',
  '#0d9488',
  '#ea580c',
]

interface GroupDraft {
  name: string
  color: string
}

function nextGroupColor(groups: GroupOut[]): string {
  const used = new Set(groups.map((group) => group.color.toLowerCase()))
  return (
    DEFAULT_GROUP_COLORS.find((color) => !used.has(color)) ??
    DEFAULT_GROUP_COLORS[groups.length % DEFAULT_GROUP_COLORS.length]
  )
}

function ColorField({
  value,
  ariaLabel,
  onChange,
}: {
  value: string
  ariaLabel: string
  onChange: (color: string) => void
}) {
  const pickerValue = parseHexColor(value) ?? DEFAULT_GROUP_COLORS[0]
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        className="h-8 w-8 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
        value={pickerValue}
        aria-label={`${ariaLabel} colour picker`}
        onChange={(event) => onChange(event.target.value)}
      />
      <Input
        className="h-8 w-24 font-mono text-xs uppercase"
        value={value}
        aria-label={`${ariaLabel} hex colour`}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

/** Add, rename, recolour and delete a team's member groups. */
export function GroupsPanel() {
  const queryClient = useQueryClient()
  const { teamId } = useConfigTeam()

  const groupsQuery = useQuery({
    queryKey: queryKeys.groups(teamId),
    queryFn: () => api.listGroups(teamId as number),
    enabled: teamId !== null,
  })
  const groups: GroupOut[] = groupsQuery.data ?? []

  const [groupDrafts, setGroupDrafts] = useState<Record<number, GroupDraft>>({})
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupColor, setNewGroupColor] = useState(DEFAULT_GROUP_COLORS[0])

  useEffect(() => {
    if (!groupsQuery.data) return
    setGroupDrafts(
      Object.fromEntries(
        groupsQuery.data.map((group) => [group.id, { name: group.name, color: group.color }]),
      ),
    )
  }, [groupsQuery.data])

  function invalidate() {
    if (teamId === null) return
    invalidateTeamData(queryClient, teamId)
  }

  const createGroup = useMutation({
    mutationFn: (payload: { name: string; color: string }) =>
      api.createGroup(teamId as number, payload),
    onSuccess: (group) => {
      setNewGroupName('')
      setNewGroupColor(nextGroupColor([...groups, group]))
      notifySuccess(`Added group '${group.name}'.`)
      invalidate()
    },
    onError: (error: Error) => notifyError(error.message),
  })

  const updateGroup = useMutation({
    mutationFn: ({ id, name, color }: { id: number; name: string; color: string }) =>
      api.updateGroup(teamId as number, id, { name, color }),
    onSuccess: (group) => {
      notifySuccess(`Updated group '${group.name}'.`)
      invalidate()
    },
    onError: (error: Error) => notifyError(error.message),
  })

  const deleteGroup = useMutation({
    mutationFn: (id: number) => api.deleteGroup(teamId as number, id),
    onSuccess: () => {
      notifySuccess('Group deleted; members were unassigned.')
      invalidate()
    },
    onError: (error: Error) => notifyError(error.message),
  })

  function patchDraft(id: number, patch: Partial<GroupDraft>) {
    setGroupDrafts((prev) => ({
      ...prev,
      [id]: { name: prev[id]?.name ?? '', color: prev[id]?.color ?? '', ...patch },
    }))
  }

  function submitNewGroup() {
    const name = newGroupName.trim()
    const color = parseHexColor(newGroupColor)
    if (!name || !color) return
    createGroup.mutate({ name, color })
  }

  return (
    <div className="flex flex-col gap-6">
      <TeamSelect />
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Groups</CardTitle>
          <CardDescription>
            Add any number of groups and pick a colour for each chip. Assign people in Team
            Configuration. Group totals drive the Cycles page group breakdown and filter.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          {teamId === null ? null : (
          <QueryPanelBody
            isLoading={groupsQuery.isLoading}
            isError={groupsQuery.isError}
            error={groupsQuery.error}
            skeleton={
              <div className="space-y-3">
                <Skeleton className="h-8 w-full max-w-md" />
                <Skeleton className="h-8 w-full max-w-md" />
              </div>
            }
          >
            <div className="space-y-3">
              {groups.length > 0 && (
                <div className="space-y-2">
                  {groups.map((group) => {
                    const draft = groupDrafts[group.id] ?? {
                      name: group.name,
                      color: group.color,
                    }
                    const nextColor = parseHexColor(draft.color)
                    const changed =
                      draft.name.trim() !== group.name || nextColor !== group.color.toLowerCase()
                    const previewName = draft.name.trim() || group.name
                    const previewColor = nextColor ?? group.color
                    return (
                      <div key={group.id} className="flex flex-wrap items-center gap-2">
                        <GroupBadge name={previewName} color={previewColor} />
                        <Input
                          className="h-8 max-w-xs"
                          value={draft.name}
                          aria-label={`Name for group ${group.name}`}
                          onChange={(event) => patchDraft(group.id, { name: event.target.value })}
                        />
                        <ColorField
                          value={draft.color}
                          ariaLabel={`Colour for group ${group.name}`}
                          onChange={(color) => patchDraft(group.id, { color })}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={
                            !changed ||
                            draft.name.trim().length === 0 ||
                            !isHexColor(draft.color) ||
                            updateGroup.isPending
                          }
                          onClick={() =>
                            updateGroup.mutate({
                              id: group.id,
                              name: draft.name.trim(),
                              color: nextColor ?? group.color,
                            })
                          }
                        >
                          Save
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
                <GroupBadge
                  name={newGroupName.trim() || 'New group'}
                  color={parseHexColor(newGroupColor) ?? DEFAULT_GROUP_COLORS[0]}
                />
                <Input
                  className="h-8 max-w-xs"
                  placeholder="New group name"
                  value={newGroupName}
                  aria-label="New group name"
                  onChange={(event) => setNewGroupName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && newGroupName.trim().length > 0) {
                      event.preventDefault()
                      submitNewGroup()
                    }
                  }}
                />
                <ColorField
                  value={newGroupColor}
                  ariaLabel="New group"
                  onChange={setNewGroupColor}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    newGroupName.trim().length === 0 ||
                    !isHexColor(newGroupColor) ||
                    createGroup.isPending
                  }
                  onClick={submitNewGroup}
                >
                  Add group
                </Button>
              </div>
            </div>
          </QueryPanelBody>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
