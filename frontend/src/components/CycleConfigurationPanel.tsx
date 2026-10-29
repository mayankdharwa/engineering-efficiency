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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '../api'
import { useTimezone } from '../hooks/useAppSettings'
import { useSelectedTeam } from '../hooks/useSelectedTeam'
import { formatCycle } from '../lib/format'
import { notifySuccess } from '../lib/notify'
import { invalidateTeamData, queryKeys } from '../lib/queryKeys'
import { requireScope, requireTeamId, type Scope } from '../lib/scope'
import { useSelectedCycleId } from '../lib/selection'
import { isoDateInTimeZone, zonedDateToUtcIso } from '../lib/timezone'
import type { CycleSettingsIn } from '../types'
import { ConfirmDialog } from './ConfirmDialog'
import { CycleSelect } from './CycleSelect'
import { QueryPanelBody } from './QueryPanelBody'
import { TeamSelect } from './TeamSelect'

/** Per-team cycle dates and working-day override. */
export function CycleConfigurationPanel() {
  const queryClient = useQueryClient()
  const timezone = useTimezone()
  const { teamId } = useSelectedTeam()

  const cyclesQuery = useQuery({
    queryKey: queryKeys.cycles(teamId),
    queryFn: teamId === null ? skipToken : () => api.listCycles(teamId),
  })
  const cycles = cyclesQuery.data ?? []
  const [selectedCycleId, setSelectedCycleId] = useSelectedCycleId(cycles, teamId)

  const scope: Scope | null =
    teamId === null || selectedCycleId === null ? null : { teamId, cycleId: selectedCycleId }

  const cycleQuery = useQuery({
    queryKey: queryKeys.cycle(scope),
    queryFn: scope === null ? skipToken : () => api.getCycleSettings(scope),
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
      api.updateCycleSettings(requireScope(scope), payload),
    onSuccess: () => {
      notifySuccess('Cycle configuration saved.')
      if (teamId !== null) invalidateTeamData(queryClient, teamId)
    },
  })

  const cycle = cycleQuery.data

  const finalizeMutation = useMutation({
    mutationFn: () => api.finalizeCycle(requireTeamId(teamId)),
    onSuccess: () => {
      notifySuccess('Cycle finalized.')
      if (teamId !== null) invalidateTeamData(queryClient, teamId)
    },
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
            Override working days for holidays.
          </CardDescription>
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
            skeleton={
              <div className="space-y-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-24 w-full" />
              </div>
            }
          >
            {cycle && (
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
          </QueryPanelBody>
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
        </CardHeader>
        <CardContent className="gap-4">
          {cycle && !cycle.is_current ? (
            <p className="text-sm text-muted-foreground">
              Finalize applies only to the current cycle.
            </p>
          ) : cycle?.archived_at ? (
            <p className="text-sm text-muted-foreground">
              This cycle is locked. Refresh the team to load the next one.
            </p>
          ) : (
            <Button
              type="button"
              variant="destructive"
              disabled={!cycle?.ready || finalizeMutation.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {finalizeMutation.isPending ? 'Finalizing…' : 'Finalize this cycle'}
            </Button>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Finalize this team's cycle?"
        description="The cycle is kept. Refresh to load the next one."
        confirmLabel="Finalize cycle"
        onConfirm={() => finalizeMutation.mutate()}
      />
    </div>
  )
}
