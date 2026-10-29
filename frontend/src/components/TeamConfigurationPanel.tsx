import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api } from '../api'
import { useConfigTeam } from '../hooks/useConfigTeam'
import { UNASSIGNED_KEY } from '../lib/groups'
import { notifySuccess } from '../lib/notify'
import { invalidateTeamData, queryKeys } from '../lib/queryKeys'
import { requireScope, type Scope } from '../lib/scope'
import type { CycleSettingsIn, GroupOut } from '../types'
import { CostConfigurationPanel } from './CostConfigurationPanel'
import { OptionSelect } from './OptionSelect'
import { QueryPanelBody } from './QueryPanelBody'
import { TeamSelect } from './TeamSelect'

/** Per-team member configuration: group assignment, capacity and planned leave. */
export function TeamConfigurationPanel() {
  const queryClient = useQueryClient()
  const { teamId } = useConfigTeam()

  const scope: Scope | null = teamId === null ? null : { teamId }
  const cycleQuery = useQuery({
    queryKey: queryKeys.cycle(scope),
    queryFn: scope === null ? skipToken : () => api.getCycleSettings(scope),
  })

  const [availability, setAvailability] = useState<Record<string, number>>({})
  const [counts, setCounts] = useState<Record<string, boolean>>({})
  const [assignments, setAssignments] = useState<Record<string, string>>({})

  useEffect(() => {
    const data = cycleQuery.data
    if (!data) return
    const next: Record<string, number> = {}
    const nextCounts: Record<string, boolean> = {}
    const nextAssignments: Record<string, string> = {}
    for (const member of data.members) {
      next[member.linear_id] = member.unavailable_days
      nextCounts[member.linear_id] = member.counts_toward_capacity
      nextAssignments[member.linear_id] =
        member.group_id === null ? UNASSIGNED_KEY : String(member.group_id)
    }
    setAvailability(next)
    setCounts(nextCounts)
    setAssignments(nextAssignments)
  }, [cycleQuery.data])

  const saveMutation = useMutation({
    mutationFn: (payload: CycleSettingsIn) => api.updateCycleSettings(requireScope(scope), payload),
    onSuccess: () => {
      notifySuccess('Team configuration saved.')
      if (teamId !== null) invalidateTeamData(queryClient, teamId)
    },
  })

  const cycle = cycleQuery.data
  const snapshotLocked = Boolean(cycle?.archived_at)
  const groups: GroupOut[] = cycle?.groups ?? []

  const groupItems = [
    { label: 'Not set', value: UNASSIGNED_KEY },
    ...groups.map((group) => ({ label: group.name, value: String(group.id) })),
  ]

  // Unavailable days can range from 0 to the number of working days in the
  // cycle. A fractional legacy value is kept as an option so it still displays.
  const maxUnavailable = Math.max(0, Math.floor(cycle?.working_days ?? 0))

  function unavailableItems(current: number) {
    const options = Array.from({ length: maxUnavailable + 1 }, (_, day) => day)
    if (!options.includes(current)) {
      options.push(current)
      options.sort((a, b) => a - b)
    }
    return options.map((value) => ({ label: String(value), value: String(value) }))
  }

  function handleSave() {
    if (!cycle) return
    saveMutation.mutate({
      members: cycle.members.map((member) => {
        const assigned = assignments[member.linear_id] ?? UNASSIGNED_KEY
        return {
          linear_id: member.linear_id,
          unavailable_days: availability[member.linear_id] ?? 0,
          counts_toward_capacity: counts[member.linear_id] ?? true,
          group_id: assigned === UNASSIGNED_KEY ? null : Number(assigned),
        }
      }),
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <TeamSelect />
      <CostConfigurationPanel />
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Team Members</CardTitle>
          <CardDescription>Group, capacity, and leave for this cycle.</CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          {teamId === null ? null : (
          <QueryPanelBody
            isLoading={cycleQuery.isLoading}
            isError={cycleQuery.isError}
            error={cycleQuery.error}
            ready={Boolean(cycle?.ready)}
            notReadyMessage={
              cycle?.message ?? 'Refresh this team in Linear Setup first.'
            }
            skeleton={<Skeleton className="h-40 w-full" />}
          >
            {cycle && (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Member</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-40">Group</TableHead>
                    <TableHead className="w-44">Counts toward capacity</TableHead>
                    <TableHead className="w-40">Unavailable days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cycle.members.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                        No members found for this team.
                      </TableCell>
                    </TableRow>
                  ) : (
                    cycle.members.map((member) => {
                      const counted = counts[member.linear_id] ?? true
                      const unavailable = availability[member.linear_id] ?? 0
                      const dayItems = unavailableItems(unavailable)
                      return (
                        <TableRow key={member.linear_id}>
                          <TableCell className={counted ? 'font-medium' : 'text-muted-foreground'}>
                            {member.name}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {member.email ?? '—'}
                          </TableCell>
                          <TableCell>
                            <OptionSelect
                              items={groupItems}
                              value={assignments[member.linear_id] ?? UNASSIGNED_KEY}
                              disabled={snapshotLocked}
                              onValueChange={(value) =>
                                setAssignments((prev) => ({
                                  ...prev,
                                  [member.linear_id]: value,
                                }))
                              }
                              size="sm"
                              className="w-full"
                              aria-label={`Group for ${member.name}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Checkbox
                              checked={counted}
                              disabled={snapshotLocked}
                              onCheckedChange={(checked) =>
                                setCounts((prev) => ({
                                  ...prev,
                                  [member.linear_id]: checked === true,
                                }))
                              }
                              aria-label={`Count ${member.name} toward capacity`}
                            />
                          </TableCell>
                          <TableCell>
                            <OptionSelect
                              items={dayItems}
                              value={String(unavailable)}
                              disabled={!counted || snapshotLocked}
                              onValueChange={(value) =>
                                setAvailability((prev) => ({
                                  ...prev,
                                  [member.linear_id]: Number(value),
                                }))
                              }
                              size="sm"
                              className="w-24"
                              aria-label={`Unavailable days for ${member.name}`}
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            )}
          </QueryPanelBody>
          )}
        </CardContent>
        {cycle?.ready && (
          <CardFooter className="justify-end">
            <Button
              type="button"
              className="min-w-32"
              disabled={saveMutation.isPending || snapshotLocked}
              onClick={handleSave}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  )
}
