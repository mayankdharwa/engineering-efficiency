import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import type { CycleSettingsIn, GroupOut } from '../types'
import { TeamSelect } from './TeamSelect'

/** Sentinel Select value for "no group". */
const NO_GROUP = 'unset'

interface Feedback {
  type: 'success' | 'error'
  message: string
}

/** Per-team member configuration: group assignment, capacity and planned leave. */
export function TeamConfigurationPanel() {
  const queryClient = useQueryClient()
  const { teamId } = useConfigTeam()

  const cycleQuery = useQuery({
    queryKey: ['cycle', teamId],
    queryFn: () => api.getCycleSettings(teamId as number),
    enabled: teamId !== null,
  })

  const [availability, setAvailability] = useState<Record<string, string>>({})
  const [counts, setCounts] = useState<Record<string, boolean>>({})
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  useEffect(() => {
    const data = cycleQuery.data
    if (!data) return
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
  }, [cycleQuery.data])

  const saveMutation = useMutation({
    mutationFn: (payload: CycleSettingsIn) =>
      api.updateCycleSettings(teamId as number, payload),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Team configuration saved.' })
      queryClient.invalidateQueries({ queryKey: ['cycle', teamId] })
      queryClient.invalidateQueries({ queryKey: ['stats', teamId] })
    },
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
  })

  const cycle = cycleQuery.data
  const groups: GroupOut[] = cycle?.groups ?? []

  const groupItems = [
    { label: 'Not set', value: NO_GROUP },
    ...groups.map((group) => ({ label: group.name, value: String(group.id) })),
  ]

  // Unavailable days can range from 0 to the number of working days in the
  // cycle. A fractional legacy value is kept as an option so it still displays.
  const maxUnavailable = Math.max(0, Math.floor(cycle?.working_days ?? 0))

  function unavailableItems(current: string) {
    const options = Array.from({ length: maxUnavailable + 1 }, (_, day) => String(day))
    if (current && !options.includes(current)) {
      options.push(current)
      options.sort((a, b) => Number(a) - Number(b))
    }
    return options.map((value) => ({ label: value, value }))
  }

  function handleSave() {
    if (!cycle) return
    saveMutation.mutate({
      members: cycle.members.map((member) => {
        const assigned = assignments[member.linear_id] ?? NO_GROUP
        return {
          linear_id: member.linear_id,
          unavailable_days: Number(availability[member.linear_id] || 0),
          counts_toward_capacity: counts[member.linear_id] ?? true,
          group_id: assigned === NO_GROUP ? null : Number(assigned),
        }
      }),
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <TeamSelect />
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Team Configuration</CardTitle>
          <CardDescription>
            Assign each person to a group and untick anyone who shouldn&apos;t count toward capacity
            (e.g. non-developers or people not on this cycle). Unavailable days (planned leave)
            reduce a person&apos;s capacity.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          {feedback && (
            <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'}>
              <AlertDescription>{feedback.message}</AlertDescription>
            </Alert>
          )}

          {teamId === null ? null : cycleQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : cycleQuery.isError ? (
            <p className="text-sm text-destructive">{cycleQuery.error.message}</p>
          ) : !cycle?.ready ? (
            <p className="text-sm text-muted-foreground">
              {cycle?.message ?? 'Refresh this team in Linear Setup to download its membership.'}
            </p>
          ) : (
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
                      const unavailable = availability[member.linear_id] ?? '0'
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
                            <Select
                              items={dayItems}
                              value={unavailable}
                              disabled={!counted}
                              onValueChange={(value) =>
                                setAvailability((prev) => ({
                                  ...prev,
                                  [member.linear_id]: value as string,
                                }))
                              }
                            >
                              <SelectTrigger
                                size="sm"
                                className="w-24"
                                aria-label={`Unavailable days for ${member.name}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {dayItems.map((item) => (
                                  <SelectItem key={item.value} value={item.value}>
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        {cycle?.ready && (
          <CardFooter className="justify-end">
            <Button
              type="button"
              className="min-w-32"
              disabled={saveMutation.isPending}
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
