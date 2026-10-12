import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { DashboardToolbar } from '../components/DashboardToolbar'
import { GroupMetricsTable } from '../components/GroupMetricsTable'
import { IssuesTable } from '../components/IssuesTable'
import { MetricCharts } from '../components/MetricCharts'
import { MetricsTable } from '../components/MetricsTable'
import { VelocityTrendChart } from '../components/VelocityTrendChart'
import { useTimezone } from '../hooks/useAppSettings'
import { useDashboardQueries } from '../hooks/useDashboardQueries'
import { buildDashboardView } from '../lib/dashboardMetrics'
import { formatMoney, formatPercent, formatPoints } from '../lib/format'
import { pickDefaultTeamId } from '../lib/selection'

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
  const timezone = useTimezone()
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  // Empty set means all groups (see isAllGroups / groupKey).
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [showDone, setShowDone] = useState(false)

  const {
    teamsQuery,
    cyclesQuery,
    issuesQuery,
    statsQuery,
    refreshMutation,
    selectedCycleId,
    setSelectedCycleId,
  } = useDashboardQueries(selectedTeamId)

  const teams = teamsQuery.data ?? []
  const cycles = cyclesQuery.data ?? []
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null
  const selectedCycle = cycles.find((cycle) => cycle.id === selectedCycleId) ?? null
  const stats = statsQuery.data
  const view = useMemo(
    () => buildDashboardView(stats, selectedGroups),
    [stats, selectedGroups],
  )

  useEffect(() => {
    const next = pickDefaultTeamId(teams, selectedTeamId)
    if (next !== selectedTeamId) setSelectedTeamId(next)
  }, [selectedTeamId, teams])

  // Group ids are team-specific, so clear the filter when the team changes.
  useEffect(() => {
    setSelectedGroups(new Set())
  }, [selectedTeamId])

  const { summary, costs } = view

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
          <DashboardToolbar
            teams={teams}
            selectedTeam={selectedTeam}
            selectedTeamId={selectedTeamId}
            onTeamChange={setSelectedTeamId}
            cycles={cycles}
            selectedCycleId={selectedCycleId}
            onCycleChange={setSelectedCycleId}
            groupOptions={view.groupOptions}
            selectedGroups={selectedGroups}
            onGroupsChange={setSelectedGroups}
            refreshPending={refreshMutation.isPending}
            onRefresh={() => selectedTeamId !== null && refreshMutation.mutate(selectedTeamId)}
            stats={stats}
            timezone={timezone}
          />

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
                <StatCard
                  label="Cost of adhoc work"
                  value={formatMoney(costs.adhocCost, costs.currency)}
                  hint={
                    costs.manDayCost > 0
                      ? `${formatPoints(summary.adhoc)} pts adhoc · ${formatMoney(
                          costs.manDayCost,
                          costs.currency,
                        )}/day`
                      : 'Set a man-day cost in Configuration'
                  }
                />
                <StatCard
                  label="Unutilized capacity cost"
                  value={formatMoney(costs.unutilizedCost, costs.currency)}
                  hint={
                    costs.manDayCost > 0
                      ? `${formatPoints(costs.unutilizedPoints)} of ${formatPoints(
                          summary.capacity,
                        )} pts unallocated`
                      : 'Set a man-day cost in Configuration'
                  }
                />
              </div>

              <MetricCharts
                members={view.chartMembers}
                fullCapacityPoints={view.fullCapacityPoints}
              />

              <VelocityTrendChart points={view.velocityTrend} />

              <Card>
                <CardHeader className="border-b">
                  <CardTitle>Group breakdown</CardTitle>
                  <CardDescription>
                    Team totals grouped by member group for the selected cycle. Add and assign
                    groups in Configuration.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <GroupMetricsTable
                    groups={stats.groups}
                    selected={selectedGroups}
                    pointsPerDay={view.pointsPerDay}
                  />
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
                  <MetricsTable
                    members={stats.members}
                    selected={selectedGroups}
                    pointsPerDay={view.pointsPerDay}
                  />
                </CardContent>
              </Card>
            </>
          )}

          <Card>
            <CardHeader className="border-b">
              <CardTitle>Issues</CardTitle>
              <CardDescription>
                {selectedCycle && !selectedCycle.is_current
                  ? "Issues stored for the selected cycle."
                  : "Issues downloaded from the team's current cycle."}
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
