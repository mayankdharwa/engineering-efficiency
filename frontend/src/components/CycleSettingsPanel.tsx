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
import { formatCycle } from '../lib/format'
import type { CycleSettingsIn, TeamOut } from '../types'

/** Convert an ISO timestamp to the `YYYY-MM-DD` an <input type="date"> wants. */
function toDateInput(value: string | null): string {
  if (!value) return ''
  // Timestamps are UTC. Treat any value without a timezone as UTC so the
  // calendar date doesn't shift a day in non-UTC timezones (browsers parse a
  // timezone-less string as local time).
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

/** Convert an <input type="date"> value back to a UTC ISO timestamp. */
function fromDateInput(value: string): string | null {
  if (!value) return null
  return new Date(`${value}T00:00:00Z`).toISOString()
}

type RoleValue = 'unset' | 'DEV' | 'QA'

const ROLE_OPTIONS: { label: string; value: RoleValue }[] = [
  { label: 'Not set', value: 'unset' },
  { label: 'DEV', value: 'DEV' },
  { label: 'QA', value: 'QA' },
]

export function CycleSettingsPanel() {
  const queryClient = useQueryClient()
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
  const [roles, setRoles] = useState<Record<string, RoleValue>>({})
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  )

  useEffect(() => {
    const data = cycleQuery.data
    if (!data) return
    setWorkingDays(String(data.working_days))
    setStartDate(toDateInput(data.starts_at))
    setEndDate(toDateInput(data.ends_at))
    const next: Record<string, string> = {}
    const nextCounts: Record<string, boolean> = {}
    const nextRoles: Record<string, RoleValue> = {}
    for (const member of data.members) {
      next[member.linear_id] = String(member.unavailable_days)
      nextCounts[member.linear_id] = member.counts_toward_capacity
      nextRoles[member.linear_id] = (member.role as RoleValue | null) ?? 'unset'
    }
    setAvailability(next)
    setCounts(nextCounts)
    setRoles(nextRoles)
  }, [cycleQuery.data])

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

  const cycle = cycleQuery.data

  function handleSave() {
    if (!cycle) return
    const parsed = Number(workingDays)
    const payload: CycleSettingsIn = {
      members: cycle.members.map((member) => ({
        linear_id: member.linear_id,
        unavailable_days: Number(availability[member.linear_id] || 0),
        counts_toward_capacity: counts[member.linear_id] ?? true,
        role: (roles[member.linear_id] ?? 'unset') === 'unset' ? null : roles[member.linear_id],
      })),
    }
    if (workingDays.trim().length > 0 && !Number.isNaN(parsed)) {
      payload.working_days = parsed
    }
    if (startDate) payload.starts_at = fromDateInput(startDate)
    if (endDate) payload.ends_at = fromDateInput(endDate)
    saveMutation.mutate(payload)
  }

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
                    <h3 className="text-sm font-medium">Members</h3>
                    <p className="text-sm text-muted-foreground">
                      Tag each person as DEV or QA to group the dashboard metrics by role. Untick
                      anyone who shouldn&apos;t count toward capacity (e.g. non-developers or people
                      not on this cycle). Unavailable days (planned leave) reduce a person&apos;s
                      capacity.
                    </p>
                  </div>
                  <div className="overflow-hidden rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Member</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead className="w-32">Role</TableHead>
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
                                    items={ROLE_OPTIONS.map((option) => ({
                                      label: option.label,
                                      value: option.value,
                                    }))}
                                    value={roles[member.linear_id] ?? 'unset'}
                                    onValueChange={(value) =>
                                      setRoles((prev) => ({
                                        ...prev,
                                        [member.linear_id]: value as RoleValue,
                                      }))
                                    }
                                  >
                                    <SelectTrigger
                                      size="sm"
                                      className="w-full"
                                      aria-label={`Role for ${member.name}`}
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {ROLE_OPTIONS.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                          {option.label}
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
