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
import { IssuesTable } from '../components/IssuesTable'
import { MetricCharts } from '../components/MetricCharts'
import { MetricsTable } from '../components/MetricsTable'
import { RoleMetricsTable } from '../components/RoleMetricsTable'
import { VelocityTrendChart } from '../components/VelocityTrendChart'
import {
  formatCycle,
  formatDate,
  formatPercent,
  formatPoints,
  formatRelative,
} from '../lib/format'
import type { RoleFilter } from '../types'

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

const ROLE_FILTERS: { label: string; value: RoleFilter }[] = [
  { label: 'All roles', value: 'all' },
  { label: 'DEV', value: 'DEV' },
  { label: 'QA', value: 'QA' },
]

export function DashboardPage() {
  const queryClient = useQueryClient()
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
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

  // Charts show only the selected role's members (or everyone for "all").
  const chartMembers =
    roleFilter === 'all'
      ? (stats?.members ?? [])
      : (stats?.members ?? []).filter((member) => member.role === roleFilter)

  // When a specific role is selected, the headline cards summarise that role
  // (the same ratio-of-totals logic the backend uses for the team).
  const roleTotals =
    roleFilter === 'all'
      ? null
      : (stats?.roles.find((entry) => entry.role === roleFilter) ?? null)
  const summary = {
    planning: roleTotals ? roleTotals.planning_efficiency : (stats?.planning_efficiency ?? null),
    velocity: roleTotals ? roleTotals.velocity : (stats?.velocity ?? null),
    bandwidth: roleTotals
      ? roleTotals.bandwidth_efficiency
      : (stats?.bandwidth_efficiency ?? null),
    planned: roleTotals ? roleTotals.planned_points : (stats?.total_planned_points ?? 0),
    taken: roleTotals ? roleTotals.taken_points : (stats?.total_taken_points ?? 0),
    done: roleTotals ? roleTotals.done_points : (stats?.total_done_points ?? 0),
    capacity: roleTotals ? roleTotals.capacity_points : (stats?.total_capacity_points ?? 0),
    adhoc: roleTotals ? roleTotals.adhoc_points : (stats?.total_adhoc_points ?? 0),
    unestimated: roleTotals ? roleTotals.unestimated_count : (stats?.unestimated_issues ?? 0),
  }

  // The trend follows the same role selection as the cards and charts.
  const velocityTrend =
    roleFilter === 'all'
      ? (stats?.velocity_trend ?? [])
      : (stats?.roles.find((entry) => entry.role === roleFilter)?.velocity_trend ?? [])

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
              <div className="w-36 shrink-0">
                <Select
                  items={ROLE_FILTERS.map((option) => ({
                    label: option.label,
                    value: option.value,
                  }))}
                  value={roleFilter}
                  onValueChange={(value) => setRoleFilter(value as RoleFilter)}
                >
                  <SelectTrigger id="role-select" className="w-full" aria-label="Role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_FILTERS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  {formatDate(stats.starts_at)} → {formatDate(stats.ends_at)} ·{' '}
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
                  <CardTitle>Role breakdown</CardTitle>
                  <CardDescription>
                    Team totals grouped by role tag. Tag members as DEV or QA in Configuration.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RoleMetricsTable roles={stats.roles} role={roleFilter} />
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
                  <MetricsTable members={stats.members} role={roleFilter} />
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
