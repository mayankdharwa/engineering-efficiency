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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '../api'
import { useTimezone } from '../hooks/useAppSettings'
import { useConfigTeam } from '../hooks/useConfigTeam'
import { formatCycle } from '../lib/format'
import { isoDateInTimeZone, zonedDateToUtcIso } from '../lib/timezone'
import type { CycleSettingsIn } from '../types'
import { TeamSelect } from './TeamSelect'

interface Feedback {
  type: 'success' | 'error'
  message: string
}

/** Per-team cycle dates and working-day override. */
export function CycleConfigurationPanel() {
  const queryClient = useQueryClient()
  const timezone = useTimezone()
  const { teamId } = useConfigTeam()

  const cycleQuery = useQuery({
    queryKey: ['cycle', teamId],
    queryFn: () => api.getCycleSettings(teamId as number),
    enabled: teamId !== null,
  })

  const [workingDays, setWorkingDays] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  useEffect(() => {
    const data = cycleQuery.data
    if (!data) return
    setWorkingDays(String(data.working_days))
    setStartDate(isoDateInTimeZone(data.starts_at, timezone))
    setEndDate(isoDateInTimeZone(data.ends_at, timezone))
  }, [cycleQuery.data, timezone])

  const saveMutation = useMutation({
    mutationFn: (payload: CycleSettingsIn) =>
      api.updateCycleSettings(teamId as number, payload),
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Cycle configuration saved.' })
      queryClient.invalidateQueries({ queryKey: ['cycle', teamId] })
      queryClient.invalidateQueries({ queryKey: ['stats', teamId] })
    },
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
  })

  const cycle = cycleQuery.data

  function handleSave() {
    if (!cycle) return
    const payload: CycleSettingsIn = {}
    const parsed = Number(workingDays)
    if (workingDays.trim().length > 0 && !Number.isNaN(parsed)) {
      payload.working_days = parsed
    }
    if (startDate) payload.starts_at = zonedDateToUtcIso(startDate, timezone)
    if (endDate) payload.ends_at = zonedDateToUtcIso(endDate, timezone)
    saveMutation.mutate(payload)
  }

  return (
    <div className="flex flex-col gap-6">
      <TeamSelect />
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Cycle Configuration</CardTitle>
          <CardDescription>
            Cycle dates come from Linear. Override the number of working days when the cycle
            contains holidays.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          {feedback && (
            <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'}>
              <AlertDescription>{feedback.message}</AlertDescription>
            </Alert>
          )}

          {teamId === null ? null : cycleQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : cycleQuery.isError ? (
            <p className="text-sm text-destructive">{cycleQuery.error.message}</p>
          ) : !cycle?.ready ? (
            <p className="text-sm text-muted-foreground">
              {cycle?.message ?? 'Refresh this team in Linear Setup to download its current cycle.'}
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
            </>
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
