import { skipToken, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '../api'
import { CycleMetricChart } from '../components/CycleMetricChart'
import { MemberHeatmapChart } from '../components/MemberHeatmapChart'
import { NoTeamsCard } from '../components/NoTeamsCard'
import { TeamPicker } from '../components/TeamPicker'
import { useSelectedTeam } from '../hooks/useSelectedTeam'
import {
  ANALYTICS_METRICS,
  groupAnalyticsChart,
  memberHeatmap,
  teamAnalyticsChart,
} from '../lib/analyticsSeries'
import { heatmapChartHeight } from '../lib/chart'
import { queryKeys } from '../lib/queryKeys'
import type { TeamAnalyticsOut } from '../types'

function cycleNote(data: TeamAnalyticsOut): string {
  const count = data.cycles.length
  const window =
    count >= data.cycle_limit
      ? `Last ${data.cycle_limit} cycles`
      : `Showing ${count} stored ${count === 1 ? 'cycle' : 'cycles'}`
  return `${window}. Bars run newest to oldest; the heatmap runs oldest to newest.`
}

export function AnalyticsPage() {
  const {
    teamsQuery,
    teams,
    teamId: selectedTeamId,
    setTeamId: setSelectedTeamId,
    selectedTeam,
  } = useSelectedTeam()

  const analyticsQuery = useQuery({
    queryKey: queryKeys.analytics(selectedTeamId),
    queryFn: selectedTeamId === null ? skipToken : () => api.getAnalytics(selectedTeamId),
  })
  const cycles = analyticsQuery.data?.cycles ?? []
  const charts = useMemo(
    () =>
      ANALYTICS_METRICS.map((metric) => {
        const members = memberHeatmap(cycles, metric.key)
        return {
          metric,
          team: teamAnalyticsChart(cycles, metric.key),
          groups: groupAnalyticsChart(cycles, metric.key),
          members,
          height: heatmapChartHeight(members.members.length),
        }
      }),
    [cycles],
  )

  return (
    <div className="flex flex-col gap-6">
      {teamsQuery.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : teams.length === 0 ? (
        <NoTeamsCard />
      ) : (
        <>
          <div className="w-64 shrink-0 sm:w-72">
            <TeamPicker
              teams={teams}
              value={selectedTeamId}
              onChange={setSelectedTeamId}
              id="analytics-team-select"
              aria-label="Team"
            />
            {selectedTeam && analyticsQuery.data ? (
              <p className="mt-2 text-xs text-muted-foreground">{cycleNote(analyticsQuery.data)}</p>
            ) : null}
          </div>

          {selectedTeamId === null || analyticsQuery.isLoading ? (
            <div className="flex flex-col gap-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-64 w-full" />
              ))}
            </div>
          ) : analyticsQuery.isError ? (
            <p className="text-sm text-destructive">{analyticsQuery.error.message}</p>
          ) : cycles.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No cycle data yet</CardTitle>
                <CardDescription>
                  Refresh this team from Cycles to load its history.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="flex flex-col gap-10">
              {charts.map(({ metric, team, groups, members, height }) => (
                <section key={metric.key} className="flex flex-col gap-4">
                  <div>
                    <h2 className="font-heading text-lg font-medium">{metric.title}</h2>
                    <p className="text-sm text-muted-foreground">{metric.description}</p>
                  </div>
                  <div className="grid items-start gap-4 xl:grid-cols-2">
                    <CycleMetricChart
                      title="Team and groups"
                      team={team}
                      groups={groups}
                      valueLabel={metric.title}
                      ariaLabel={`${metric.title} for the team and each group`}
                      height={height}
                    />
                    <MemberHeatmapChart
                      title="Members"
                      model={members}
                      metric={metric.key}
                      valueLabel={metric.title}
                      ariaLabel={`${metric.title} heatmap by member and cycle`}
                      height={height}
                    />
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
