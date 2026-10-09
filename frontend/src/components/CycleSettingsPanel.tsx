import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
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
import { useTimezone } from '../hooks/useAppSettings'
import { formatCycle } from '../lib/format'
import { isoDateInTimeZone, zonedDateToUtcIso } from '../lib/timezone'
import type { CycleSettingsIn, GroupOut, TeamOut } from '../types'

/** Sentinel Select value for "no group". */
const NO_GROUP = 'unset'

type Feedback = { type: 'success' | 'error'; message: string }

export function CycleSettingsPanel() {
  const queryClient = useQueryClient()
  const timezone = useTimezone()
  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: api.listTeams })
  const teams: TeamOut[] = teamsQuery.data ?? []
  const [teamId, setTeamId] = useState<number | null>(null)

  useEffect(() => {
    if (teams.length === 0) return
    // Fall back to the first team when nothing is selected or the selected
    // team no longer exists (e.g. it was just deleted).
    if (teamId === null || !teams.some((team) => team.id === teamId)) {
      setTeamId(teams[0].id)
    }
  }, [teamId, teams])

  const cycleQuery = useQuery({
    queryKey: ['cycle', teamId],
    queryFn: () => api.getCycleSettings(teamId as number),
    enabled: teamId !== null,
  })

  const [workingDays, setWorkingDays] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [availability, setAvailability] = useState<Record<string, string>>({})
  const [counts, setCounts] = useState<Record<string, boolean>>({})
  // Member group assignment, keyed by linear id; value is a group id or NO_GROUP.
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  // Draft text for renaming each group, keyed by group id.
  const [groupDrafts, setGroupDrafts] = useState<Record<number, string>>({})
  const [newGroupName, setNewGroupName] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  useEffect(() => {
    const data = cycleQuery.data
    if (!data) return
    setWorkingDays(String(data.working_days))
    setStartDate(isoDateInTimeZone(data.starts_at, timezone))
    setEndDate(isoDateInTimeZone(data.ends_at, timezone))
    const next: Record<string, string> = {}
    const nextCounts: Record<string, boolean> = {}
    const nextAssignments: Record<string, string> = {}
    for (const member of data.members) {
      next[member.linear_id] = String(member.unavailable_days)
      nextCounts[member.linear_id] = member.counts_toward_capacity
      nextAssignments[member.linear_id] =
        member.group_id === null ? NO_GROUP : String(member.group_id)
    }
    setAvailability(next)
    setCounts(nextCounts)
    setAssignments(nextAssignments)
    setGroupDrafts(
      Object.fromEntries(data.groups.map((group) => [group.id, group.name])),
    )
  }, [cycleQuery.data, timezone])

  const saveMutation = useMutation({
    mutationFn: (payload: CycleSettingsIn) =>
      api.updateCycleSettings(teamId as number, payload),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Cycle settings saved.' })
      queryClient.invalidateQueries({ queryKey: ['cycle', teamId] })
      queryClient.invalidateQueries({ queryKey: ['stats', teamId] })
    },
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
  })

  const createGroup = useMutation({
    mutationFn: (name: string) => api.createGroup(teamId as number, name),
    onSuccess: (group) => {
      setNewGroupName('')
      setFeedback({ type: 'success', message: `Added group '${group.name}'.` })
      queryClient.invalidateQueries({ queryKey: ['cycle', teamId] })
      queryClient.invalidateQueries({ queryKey: ['stats', teamId] })
    },
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
  })

  const renameGroup = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.renameGroup(teamId as number, id, name),
    onSuccess: (group) => {
      setFeedback({ type: 'success', message: `Renamed group to '${group.name}'.` })
      queryClient.invalidateQueries({ queryKey: ['cycle', teamId] })
      queryClient.invalidateQueries({ queryKey: ['stats', teamId] })
    },
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
  })

  const deleteGroup = useMutation({
    mutationFn: (id: number) => api.deleteGroup(teamId as number, id),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Group deleted; members were unassigned.' })
      queryClient.invalidateQueries({ queryKey: ['cycle', teamId] })
      queryClient.invalidateQueries({ queryKey: ['stats', teamId] })
    },
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
  })

  const cycle = cycleQuery.data
  const groups: GroupOut[] = cycle?.groups ?? []

  function handleSave() {
    if (!cycle) return
    const parsed = Number(workingDays)
    const payload: CycleSettingsIn = {
      members: cycle.members.map((member) => {
        const assigned = assignments[member.linear_id] ?? NO_GROUP
        return {
          linear_id: member.linear_id,
          unavailable_days: Number(availability[member.linear_id] || 0),
          counts_toward_capacity: counts[member.linear_id] ?? true,
          group_id: assigned === NO_GROUP ? null : Number(assigned),
        }
      }),
    }
    if (workingDays.trim().length > 0 && !Number.isNaN(parsed)) {
      payload.working_days = parsed
    }
    if (startDate) payload.starts_at = zonedDateToUtcIso(startDate, timezone)
    if (endDate) payload.ends_at = zonedDateToUtcIso(endDate, timezone)
    saveMutation.mutate(payload)
  }

  const groupItems = [
    { label: 'Not set', value: NO_GROUP },
    ...groups.map((group) => ({ label: group.name, value: String(group.id) })),
  ]

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Cycle &amp; availability</CardTitle>
        <CardDescription>
          Cycle dates come from Linear. Choose who counts toward the team&apos;s capacity, override
          working days for holidays, and add planned leave per person. A working day is{' '}
          {cycle?.points_per_day ?? 2} points.
        </CardDescription>
        {cycle?.ready && (
          <CardAction>
            <Button
              type="button"
              disabled={saveMutation.isPending}
              onClick={handleSave}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="gap-5">
        {teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">Import teams from Linear first.</p>
        ) : (
          <>
            <div className="max-w-xs space-y-2">
              <Label htmlFor="cycle-team">Team</Label>
              <Select
                items={teams.map((team) => ({
                  label: `${team.name} (${team.key})`,
                  value: team.id,
                }))}
                value={teamId}
                onValueChange={(value) => {
                  setFeedback(null)
                  setTeamId(value as number | null)
                }}
              >
                <SelectTrigger id="cycle-team" className="w-full">
                  <SelectValue placeholder="Select a team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name} ({team.key})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {feedback && (
              <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'}>
                <AlertDescription>{feedback.message}</AlertDescription>
              </Alert>
            )}

            {cycleQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : cycleQuery.isError ? (
              <p className="text-sm text-destructive">{cycleQuery.error.message}</p>
            ) : !cycle?.ready ? (
              <p className="text-sm text-muted-foreground">
                {cycle?.message ?? 'Refresh this team to download its current cycle.'}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium">
                    {formatCycle(cycle.cycle_name, cycle.cycle_number)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {cycle.working_days_overridden
                      ? `${cycle.working_days} working days (Linear default ${cycle.default_working_days})`
                      : `${cycle.working_days} working days`}
                  </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="cycle-start">Cycle start</Label>
                    <Input
                      id="cycle-start"
                      type="date"
                      value={startDate}
                      onChange={(event) => setStartDate(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cycle-end">Cycle end</Label>
                    <Input
                      id="cycle-end"
                      type="date"
                      value={endDate}
                      onChange={(event) => setEndDate(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cycle-working-days">Working days</Label>
                    <Input
                      id="cycle-working-days"
                      type="number"
                      min={0}
                      max={60}
                      step={0.5}
                      value={workingDays}
                      onChange={(event) => setWorkingDays(event.target.value)}
                    />
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-medium">Groups</h3>
                    <p className="text-sm text-muted-foreground">
                      Add any number of groups, then assign each person to one of them. Group totals
                      drive the dashboard&apos;s group breakdown and filter.
                    </p>
                  </div>

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
                              onClick={() =>
                                renameGroup.mutate({ id: group.id, name: draft.trim() })
                              }
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

                <Separator />

                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-medium">Members</h3>
                    <p className="text-sm text-muted-foreground">
                      Assign each person to a group and untick anyone who shouldn&apos;t count toward
                      capacity (e.g. non-developers or people not on this cycle). Unavailable days
                      (planned leave) reduce a person&apos;s capacity.
                    </p>
                  </div>
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
                            <TableCell
                              colSpan={5}
                              className="h-20 text-center text-muted-foreground"
                            >
                              No members found for this team.
                            </TableCell>
                          </TableRow>
                        ) : (
                          cycle.members.map((member) => {
                            const counted = counts[member.linear_id] ?? true
                            return (
                              <TableRow key={member.linear_id}>
                                <TableCell
                                  className={
                                    counted ? 'font-medium' : 'text-muted-foreground'
                                  }
                                >
                                  {member.name}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {member.email ?? '—'}
                                </TableCell>
                                <TableCell>
                                  <Select
                                    items={groupItems}
                                    value={assignments[member.linear_id] ?? NO_GROUP}
                                    onValueChange={(value) =>
                                      setAssignments((prev) => ({
                                        ...prev,
                                        [member.linear_id]: value as string,
                                      }))
                                    }
                                  >
                                    <SelectTrigger
                                      size="sm"
                                      className="w-full"
                                      aria-label={`Group for ${member.name}`}
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {groupItems.map((item) => (
                                        <SelectItem key={item.value} value={item.value}>
                                          {item.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell>
                                  <Checkbox
                                    checked={counted}
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
                                  <Input
                                    className="h-8 w-28"
                                    type="number"
                                    min={0}
                                    max={60}
                                    step={0.5}
                                    disabled={!counted}
                                    value={availability[member.linear_id] ?? '0'}
                                    onChange={(event) =>
                                      setAvailability((prev) => ({
                                        ...prev,
                                        [member.linear_id]: event.target.value,
                                      }))
                                    }
                                  />
                                </TableCell>
                              </TableRow>
                            )
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
