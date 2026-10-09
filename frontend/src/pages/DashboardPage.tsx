import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { RefreshCwIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { api } from '../api'
import { GroupFilterSelect } from '../components/GroupFilterSelect'
import { GroupMetricsTable } from '../components/GroupMetricsTable'
import { IssuesTable } from '../components/IssuesTable'
import { MetricCharts } from '../components/MetricCharts'
import { MetricsTable } from '../components/MetricsTable'
import { VelocityTrendChart } from '../components/VelocityTrendChart'
import { useTimezone } from '../hooks/useAppSettings'
import {
  combineGroups,
  filterMembers,
  isAllGroups,
} from '../lib/groups'
import {
  formatCycle,
  formatDate,
  formatPercent,
  formatPoints,
  formatRelative,
} from '../lib/format'
import type { GroupOut } from '../types'

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </CardContent>
    </Card>
  )
}

export function DashboardPage() {
  const queryClient = useQueryClient()
  const timezone = useTimezone()
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [showDone, setShowDone] = useState(false)

  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: api.listTeams })
  const teams = teamsQuery.data ?? []

  useEffect(() => {
    if (teams.length === 0) return
    // Fall back to the first team when nothing is selected or the selected
    // team no longer exists (e.g. it was deleted on the config page).
    if (selectedTeamId === null || !teams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(teams[0].id)
    }
  }, [selectedTeamId, teams])

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null

  // Group ids are team-specific, so clear the filter when the team changes.
  useEffect(() => {
    setSelectedGroups(new Set())
  }, [selectedTeamId])

  const issuesQuery = useQuery({
    queryKey: ['issues', selectedTeamId],
    queryFn: () => api.listIssues(selectedTeamId as number),
    enabled: selectedTeamId !== null,
  })

  const statsQuery = useQuery({
    queryKey: ['stats', selectedTeamId],
    queryFn: () => api.getStats(selectedTeamId as number),
    enabled: selectedTeamId !== null,
  })

  const refreshMutation = useMutation({
    mutationFn: (teamId: number) => api.refreshTeam(teamId),
    onSuccess: (_result, teamId) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['issues', teamId] })
      queryClient.invalidateQueries({ queryKey: ['cycle', teamId] })
      queryClient.invalidateQueries({ queryKey: ['stats', teamId] })
    },
  })

  const stats = statsQuery.data
  const allGroups = isAllGroups(selectedGroups)

  // When specific groups are selected, combine their precomputed totals using
  // the same ratio-of-totals logic the backend uses for the team.
  const groupSummary =
    stats && !allGroups ? combineGroups(stats.groups, selectedGroups, stats.progress) : null

  // Charts show only the selected groups' members (or everyone for "All").
  const chartMembers = filterMembers(stats?.members ?? [], selectedGroups)

  const summary = groupSummary
    ? groupSummary
    : {
        planning: stats?.planning_efficiency ?? null,
        velocity: stats?.velocity ?? null,
        bandwidth: stats?.bandwidth_efficiency ?? null,
        planned: stats?.total_planned_points ?? 0,
        taken: stats?.total_taken_points ?? 0,
        done: stats?.total_done_points ?? 0,
        capacity: stats?.total_capacity_points ?? 0,
        adhoc: stats?.total_adhoc_points ?? 0,
        unestimated: stats?.unestimated_issues ?? 0,
      }

  // The trend follows the same group selection as the cards and charts.
  const velocityTrend = groupSummary ? groupSummary.trend : (stats?.velocity_trend ?? [])

  // Defined groups (everything except the synthetic Unassigned bucket).
  const groupOptions: GroupOut[] = (stats?.groups ?? [])
    .filter((group) => group.group_id !== null)
    .map((group) => ({ id: group.group_id as number, name: group.label }))

  return (
    <div className="flex flex-col gap-6">
      {teamsQuery.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : teams.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No teams available</CardTitle>
            <CardDescription>
              Configure your Linear API key and import teams before viewing stats.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/config" className={buttonVariants()}>
              Go to configuration
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex flex-wrap items-start gap-4">
              <div className="w-64 shrink-0 sm:w-72">
                <Select
                  items={teams.map((team) => ({
                    label: `${team.name} (${team.key})`,
                    value: team.id,
                  }))}
                  value={selectedTeamId}
                  onValueChange={(value) => setSelectedTeamId(value as number | null)}
                >
                  <SelectTrigger id="team-select" className="w-full" aria-label="Team">
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
                {selectedTeam && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {selectedTeam.issue_count} stored issue(s) · synced{' '}
                    {formatRelative(selectedTeam.last_synced_at)}
                  </p>
                )}
              </div>
              <div className="w-44 shrink-0">
                <GroupFilterSelect
                  groups={groupOptions}
                  selected={selectedGroups}
                  onChange={setSelectedGroups}
                />
              </div>
              <Button
                type="button"
                disabled={selectedTeamId === null || refreshMutation.isPending}
                onClick={() => selectedTeamId !== null && refreshMutation.mutate(selectedTeamId)}
              >
                <RefreshCwIcon
                  className={refreshMutation.isPending ? 'animate-spin' : undefined}
                />
                {refreshMutation.isPending ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
            {stats?.ready && (
              <div className="ml-auto text-right leading-tight">
                <div className="text-xl font-semibold tabular-nums">
                  {formatCycle(stats.cycle_name, stats.cycle_number)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDate(stats.starts_at, timezone)} →{' '}
                  {formatDate(stats.ends_at, timezone)} ·{' '}
                  {stats.working_days_overridden
                    ? `${formatPoints(stats.working_days)} working days (adjusted)`
                    : `${formatPoints(stats.working_days)} working days`}
                </div>
              </div>
            )}
          </div>

          {statsQuery.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-24 w-full" />
              ))}
            </div>
          ) : statsQuery.isError ? (
            <p className="text-sm text-destructive">{statsQuery.error.message}</p>
          ) : !stats?.ready ? (
            <Card>
              <CardHeader>
                <CardTitle>No cycle data yet</CardTitle>
                <CardDescription>
                  {stats?.message ?? 'Refresh this team to download its cycle.'}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Planning efficiency"
                  value={formatPercent(summary.planning)}
                  hint={`${formatPoints(summary.planned)} of ${formatPoints(
                    summary.taken,
                  )} pts planned`}
                />
                <StatCard
                  label="Velocity"
                  value={formatPercent(summary.velocity)}
                  hint={`${formatPoints(summary.done)} pts done · ${formatPercent(
                    stats.progress,
                  )} elapsed`}
                />
                <StatCard
                  label="Bandwidth efficiency"
                  value={formatPercent(summary.bandwidth)}
                  hint={`${formatPoints(summary.taken)} of ${formatPoints(
                    summary.capacity,
                  )} pts capacity`}
                />
                <StatCard
                  label="Adhoc points"
                  value={formatPoints(summary.adhoc)}
                  hint={
                    summary.unestimated > 0
                      ? `${summary.unestimated} unestimated issue(s)`
                      : 'attached after the first day'
                  }
                />
              </div>

              <MetricCharts members={chartMembers} />

              <VelocityTrendChart points={velocityTrend} />

              <Card>
                <CardHeader className="border-b">
                  <CardTitle>Group breakdown</CardTitle>
                  <CardDescription>
                    Team totals grouped by member group. Add and assign groups in Configuration.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <GroupMetricsTable groups={stats.groups} selected={selectedGroups} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b">
                  <CardTitle>Per-person breakdown</CardTitle>
                  <CardDescription>
                    Cycle metrics for members who count toward capacity.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <MetricsTable members={stats.members} selected={selectedGroups} />
                </CardContent>
              </Card>
            </>
          )}

          <Card>
            <CardHeader className="border-b">
              <CardTitle>Issues</CardTitle>
              <CardDescription>
                Issues downloaded from the team&apos;s current cycle.
              </CardDescription>
              {!issuesQuery.isLoading && !issuesQuery.isError && (
                <CardAction>
                  <Label className="font-normal text-muted-foreground">
                    Show done
                    <Switch
                      checked={showDone}
                      onCheckedChange={(checked) => setShowDone(checked)}
                    />
                  </Label>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {issuesQuery.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : issuesQuery.isError ? (
                <p className="text-sm text-destructive">{issuesQuery.error.message}</p>
              ) : (
                <IssuesTable issues={issuesQuery.data ?? []} showDone={showDone} />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
