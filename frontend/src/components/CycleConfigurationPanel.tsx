import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { notifyError, notifySuccess } from '../lib/notify'
import { isoDateInTimeZone, zonedDateToUtcIso } from '../lib/timezone'
import type { CycleSettingsIn } from '../types'
import { CycleSelect } from './CycleSelect'
import { TeamSelect } from './TeamSelect'

/** Per-team cycle dates and working-day override. */
export function CycleConfigurationPanel() {
  const queryClient = useQueryClient()
  const timezone = useTimezone()
  const { teamId } = useConfigTeam()
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null)

  const cyclesQuery = useQuery({
    queryKey: ['cycles', teamId],
    queryFn: () => api.listCycles(teamId as number),
    enabled: teamId !== null,
  })
  const cycles = cyclesQuery.data ?? []

  useEffect(() => {
    setSelectedCycleId(null)
  }, [teamId])

  useEffect(() => {
    if (cycles.length === 0) return
    if (selectedCycleId === null || !cycles.some((cycle) => cycle.id === selectedCycleId)) {
      const current = cycles.find((cycle) => cycle.is_current)
      setSelectedCycleId(current?.id ?? cycles[0].id)
    }
  }, [cycles, selectedCycleId])

  const cycleQuery = useQuery({
    queryKey: ['cycle', teamId, selectedCycleId],
    queryFn: () => api.getCycleSettings(teamId as number, selectedCycleId),
    enabled: teamId !== null && selectedCycleId !== null,
  })

  const [workingDays, setWorkingDays] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    const data = cycleQuery.data
    if (!data) return
    setWorkingDays(String(data.working_days))
    setStartDate(isoDateInTimeZone(data.starts_at, timezone))
    setEndDate(isoDateInTimeZone(data.ends_at, timezone))
  }, [cycleQuery.data, timezone])

  const saveMutation = useMutation({
    mutationFn: (payload: CycleSettingsIn) =>
      api.updateCycleSettings(teamId as number, payload, selectedCycleId),
    onSuccess: () => {
      notifySuccess('Cycle configuration saved.')
      queryClient.invalidateQueries({ queryKey: ['cycle', teamId] })
      queryClient.invalidateQueries({ queryKey: ['cycles', teamId] })
      queryClient.invalidateQueries({ queryKey: ['stats', teamId] })
    },
    onError: (error: Error) => notifyError(error.message),
  })

  const cycle = cycleQuery.data

  const finalizeMutation = useMutation({
    mutationFn: () => api.finalizeCycle(teamId as number),
    onSuccess: () => {
      notifySuccess(
        'Cycle finalized. Its data is preserved; refresh the team to load the next cycle.',
      )
      queryClient.invalidateQueries({ queryKey: ['cycle', teamId] })
      queryClient.invalidateQueries({ queryKey: ['cycles', teamId] })
      queryClient.invalidateQueries({ queryKey: ['stats', teamId] })
    },
    onError: (error: Error) => notifyError(error.message),
  })

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

  const finalized = Boolean(cycle?.archived_at)

  return (
    <div className="flex flex-col gap-6">
      <TeamSelect />
      {teamId !== null && (
        <CycleSelect
          cycles={cycles}
          value={selectedCycleId}
          onChange={setSelectedCycleId}
        />
      )}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Cycle Configuration</CardTitle>
          <CardDescription>
            Cycle dates come from Linear. Override the number of working days when the cycle
            contains holidays.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
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
                    disabled={finalized}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cycle-end">Cycle end</Label>
                  <Input
                    id="cycle-end"
                    type="date"
                    value={endDate}
                    disabled={finalized}
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
                    disabled={finalized}
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
              disabled={saveMutation.isPending || finalized}
              onClick={handleSave}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </CardFooter>
        )}
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Finalize Cycle</CardTitle>
          <CardDescription>
            Mark this team&apos;s current cycle as finished so it can be refreshed into a
            newer one. The cycle&apos;s data is preserved for history, and only this team is
            affected, so teams on different cycle schedules roll over independently.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          {cycle && !cycle.is_current ? (
            <p className="text-sm text-muted-foreground">
              This is a historical cycle. Finalize applies only to the team&apos;s current cycle.
            </p>
          ) : cycle?.archived_at ? (
            <p className="text-sm text-muted-foreground">
              This cycle is finalized and locked. Refresh the team once Linear moves on to load
              the next cycle; group and capacity settings will be copied forward.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="destructive"
                disabled={!cycle?.ready || finalizeMutation.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                {finalizeMutation.isPending ? 'Finalizing…' : 'Finalize this cycle'}
              </Button>
              <span className="text-xs text-muted-foreground">
                Required before a refresh can switch the team to a newer cycle.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize this team&apos;s cycle?</AlertDialogTitle>
            <AlertDialogDescription>
              The current cycle is marked as finished and kept for history. Refreshing
              afterwards will download the team&apos;s next cycle. This only affects this
              team.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false)
                finalizeMutation.mutate()
              }}
            >
              Finalize cycle
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
