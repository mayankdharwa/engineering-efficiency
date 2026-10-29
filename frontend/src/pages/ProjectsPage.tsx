import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCwIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { api } from '../api'
import { IssuesTable } from '../components/IssuesTable'
import { NoTeamsCard } from '../components/NoTeamsCard'
import { PersonLoadChart } from '../components/PersonLoadChart'
import { ProjectCostChart } from '../components/ProjectCostChart'
import { ProjectDueDateTrajectory } from '../components/ProjectDueDateTrajectory'
import { ProjectRangeSelect } from '../components/ProjectRangeSelect'
import { ProjectSpanChart } from '../components/ProjectSpanChart'
import { ProjectStateFilter } from '../components/ProjectStateFilter'
import { ProjectsTable } from '../components/ProjectsTable'
import { StatCard } from '../components/StatCard'
import { TeamPicker } from '../components/TeamPicker'
import { useCanRefresh } from '../hooks/useAuth'
import { useSelectedTeam } from '../hooks/useSelectedTeam'
import { formatMoney, formatPoints, formatRelative } from '../lib/format'
import { notifySuccess } from '../lib/notify'
import { DEFAULT_PROJECT_RANGE_MONTHS, type ProjectRangeMonths } from '../lib/projectRange'
import { durationExceedsManDays } from '../lib/projectSchedule'
import {
  DEFAULT_PROJECT_STATES,
  filterProjectsByState,
} from '../lib/projectState'
import { invalidateTeamData, queryKeys } from '../lib/queryKeys'
import type { ProjectOut } from '../types'

export function ProjectsPage() {
  const queryClient = useQueryClient()
  const canRefresh = useCanRefresh()
  const {
    teamsQuery,
    teams,
    teamId: selectedTeamId,
    setTeamId: setSelectedTeamId,
    selectedTeam,
  } = useSelectedTeam()
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [selectedStates, setSelectedStates] = useState<Set<string>>(
    () => new Set(DEFAULT_PROJECT_STATES),
  )
  const [trajectoryStates, setTrajectoryStates] = useState<Set<string>>(
    () => new Set(DEFAULT_PROJECT_STATES),
  )
  const [spanStates, setSpanStates] = useState<Set<string>>(
    () => new Set(DEFAULT_PROJECT_STATES),
  )
  const [spanDurationExceeds, setSpanDurationExceeds] = useState(false)
  const [costStates, setCostStates] = useState<Set<string>>(
    () => new Set(DEFAULT_PROJECT_STATES),
  )
  const [showDone, setShowDone] = useState(true)
  const [completedWithinMonths, setCompletedWithinMonths] = useState<ProjectRangeMonths>(
    DEFAULT_PROJECT_RANGE_MONTHS,
  )

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects(selectedTeamId, completedWithinMonths),
    queryFn: () => api.listProjects(selectedTeamId as number, completedWithinMonths),
    enabled: selectedTeamId !== null,
  })
  const cycleQuery = useQuery({
    queryKey: queryKeys.cycle(selectedTeamId),
    queryFn: () => api.getCycleSettings(selectedTeamId as number),
    enabled: selectedTeamId !== null,
  })
  const projects = projectsQuery.data ?? []
  const includedProjects = useMemo(
    () => projects.filter((project) => !project.excluded),
    [projects],
  )
  const visibleProjects = useMemo(
    () => filterProjectsByState(projects, selectedStates),
    [projects, selectedStates],
  )
  const chartProjects = useMemo(
    () =>
      filterProjectsByState(projects, costStates).filter((project) => !project.excluded),
    [projects, costStates],
  )
  const trajectoryProjects = useMemo(
    () => filterProjectsByState(projects, trajectoryStates),
    [projects, trajectoryStates],
  )
  const spanProjects = useMemo(
    () =>
      filterProjectsByState(projects, spanStates).filter(
        (project) =>
          !spanDurationExceeds ||
          durationExceedsManDays(project.start_date, project.target_date, project.points),
      ),
    [projects, spanStates, spanDurationExceeds],
  )
  const selectedProject =
    visibleProjects.find((project) => project.id === selectedProjectId) ?? null

  const refreshMutation = useMutation({
    mutationFn: (teamId: number) => api.refreshProjects(teamId),
    onSuccess: (result, teamId) => {
      notifySuccess(result.message ?? `Synced ${result.projects_synced} project(s).`)
      invalidateTeamData(queryClient, teamId)
    },
  })
  const excludeMutation = useMutation({
    mutationFn: ({
      teamId,
      project,
    }: {
      teamId: number
      project: ProjectOut
    }) => api.updateProject(teamId, project.id, { excluded: !project.excluded }),
    onSuccess: (updated, { teamId }) => {
      notifySuccess(updated.excluded ? 'Project excluded.' : 'Project included.')
      queryClient.invalidateQueries({ queryKey: queryKeys.projects(teamId) })
    },
  })
  const syncProjectMutation = useMutation({
    mutationFn: ({ teamId, projectId }: { teamId: number; projectId: number }) =>
      api.refreshProject(teamId, projectId),
    onSuccess: (result, { teamId }) => {
      notifySuccess(result.message ?? 'Project synced.')
      invalidateTeamData(queryClient, teamId)
    },
  })

  useEffect(() => {
    setSelectedProjectId(null)
  }, [selectedTeamId])

  const totals = useMemo(() => {
    return includedProjects.reduce(
      (acc, project) => ({
        points: acc.points + project.points,
        cost: acc.cost + project.cost,
        issues: acc.issues + project.issue_count,
      }),
      { points: 0, cost: 0, issues: 0 },
    )
  }, [includedProjects])
  const excludedCount = projects.length - includedProjects.length

  const currency = includedProjects[0]?.currency ?? projects[0]?.currency ?? '$'
  const manDayCost = includedProjects[0]?.man_day_cost ?? projects[0]?.man_day_cost ?? 0
  const lastSynced = projects.reduce<string | null>((latest, project) => {
    if (!project.last_synced_at) return latest
    if (!latest || project.last_synced_at > latest) return project.last_synced_at
    return latest
  }, null)

  return (
    <div className="flex flex-col gap-6">
      {teamsQuery.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : teams.length === 0 ? (
        <NoTeamsCard />
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-4">
            <div className="w-64 shrink-0 sm:w-72">
              <TeamPicker
                teams={teams}
                value={selectedTeamId}
                onChange={setSelectedTeamId}
                id="project-team-select"
                aria-label="Team"
              />
              {selectedTeam && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {lastSynced
                    ? `Projects synced ${formatRelative(lastSynced)}`
                    : 'Projects have not been synced yet'}
                  {' · issues sync for Planned and In Progress'}
                </p>
              )}
            </div>
            <ProjectRangeSelect
              value={completedWithinMonths}
              onChange={setCompletedWithinMonths}
            />
            <Button
              type="button"
              disabled={selectedTeamId === null || refreshMutation.isPending || !canRefresh}
              onClick={() => selectedTeamId !== null && refreshMutation.mutate(selectedTeamId)}
              title={canRefresh ? undefined : 'Managers and admins can refresh'}
            >
              <RefreshCwIcon className={refreshMutation.isPending ? 'animate-spin' : undefined} />
              {refreshMutation.isPending ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>

          {projectsQuery.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-24 w-full" />
              ))}
            </div>
          ) : projectsQuery.isError ? (
            <p className="text-sm text-destructive">{projectsQuery.error.message}</p>
          ) : projects.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No projects in this range</CardTitle>
                <CardDescription>
                  Choose a longer range, or refresh this team to load its projects.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                  label="Projects"
                  value={includedProjects.length}
                  hint={
                    excludedCount > 0
                      ? `${totals.issues} issue(s) · ${excludedCount} excluded`
                      : `${totals.issues} issue(s) across all projects`
                  }
                />
                <StatCard
                  label="Points"
                  value={formatPoints(totals.points)}
                  hint="Canceled issues and excluded projects are omitted"
                />
                <StatCard
                  label="Total cost"
                  value={formatMoney(totals.cost, currency)}
                  hint={
                    manDayCost > 0
                      ? `${formatMoney(manDayCost, currency)}/day`
                      : 'Set a man-day cost in Settings'
                  }
                />
              </div>

              <Card>
                <CardHeader className="border-b">
                  <CardTitle>Project details</CardTitle>
                  <CardAction>
                    <div className="w-52">
                      <ProjectStateFilter
                        selected={selectedStates}
                        onChange={setSelectedStates}
                      />
                    </div>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <ProjectsTable
                    projects={visibleProjects}
                    selectedProjectId={selectedProjectId}
                    onSelect={(project) =>
                      setSelectedProjectId((current) =>
                        current === project.id ? null : project.id,
                      )
                    }
                    onToggleExcluded={(project) =>
                      selectedTeamId !== null &&
                      excludeMutation.mutate({ teamId: selectedTeamId, project })
                    }
                    onSyncProject={
                      canRefresh
                        ? (project) =>
                            selectedTeamId !== null &&
                            syncProjectMutation.mutate({
                              teamId: selectedTeamId,
                              projectId: project.id,
                            })
                        : undefined
                    }
                    emptyMessage={
                      visibleProjects.length === 0
                        ? 'No projects match the current state filter.'
                        : undefined
                    }
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b">
                  <CardTitle>Project Duration vs Man Day Consumption</CardTitle>
                  <CardDescription>
                    Project Duration is the gray bar: weekdays from the start date
                    through the end date. Man Days is the outlined bar on top, grouped
                    by team. White is points with no team. The number after each bar is
                    the gap between duration and man days. A check after that number
                    means the project is completed. Projects missing either date are
                    left out.
                  </CardDescription>
                  <CardAction>
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <Label
                        htmlFor="span-duration-exceeds"
                        className="font-normal text-muted-foreground"
                      >
                        <Checkbox
                          id="span-duration-exceeds"
                          checked={spanDurationExceeds}
                          onCheckedChange={(checked) => setSpanDurationExceeds(checked === true)}
                        />
                        Duration exceeds man days
                      </Label>
                      <div className="w-52">
                        <ProjectStateFilter
                          id="span-state-filter"
                          selected={spanStates}
                          onChange={setSpanStates}
                        />
                      </div>
                    </div>
                  </CardAction>
                </CardHeader>
                <CardContent className="pt-4">
                  {cycleQuery.isLoading ? (
                    <Skeleton className="h-40 w-full" />
                  ) : (
                    <ProjectSpanChart
                      projects={spanProjects}
                      members={(cycleQuery.data?.members ?? []).map((member) => ({
                        name: member.name,
                        groupId: member.group_id,
                      }))}
                      groups={cycleQuery.data?.groups ?? []}
                    />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b">
                  <CardTitle>Due date trajectory</CardTitle>
                  <CardDescription>
                    Each bar runs from the start date to the due dates. Green is the
                    start through the first due date, and amber is each later change.
                    S is the start, D is the current due date, and open dots are
                    earlier due dates. A check beside D means the project is completed.
                  </CardDescription>
                  <CardAction>
                    <div className="w-52">
                      <ProjectStateFilter
                        id="trajectory-state-filter"
                        selected={trajectoryStates}
                        onChange={setTrajectoryStates}
                      />
                    </div>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <ProjectDueDateTrajectory projects={trajectoryProjects} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b">
                  <CardTitle>Who is on what</CardTitle>
                  <CardDescription>
                    Counted people on the current cycle. The filled part of each bar
                    is points already done. The lighter part is still open.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {cycleQuery.isLoading ? (
                    <Skeleton className="h-40 w-full" />
                  ) : cycleQuery.isError ? (
                    <p className="text-sm text-destructive">{cycleQuery.error.message}</p>
                  ) : (
                    <PersonLoadChart
                      projects={projects}
                      countedPeople={(cycleQuery.data?.members ?? [])
                        .filter((member) => member.counts_toward_capacity)
                        .map((member) => ({
                          name: member.name,
                          groupName: member.group_name,
                          groupColor:
                            member.group_id == null
                              ? null
                              : (cycleQuery.data?.groups.find((group) => group.id === member.group_id)
                                  ?.color ?? null),
                        }))}
                    />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b">
                  <CardTitle>Project costs</CardTitle>
                  <CardAction>
                    <div className="w-52">
                      <ProjectStateFilter
                        id="cost-state-filter"
                        selected={costStates}
                        onChange={setCostStates}
                      />
                    </div>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <ProjectCostChart projects={chartProjects} />
                </CardContent>
              </Card>

              {selectedProject && (
                <Card>
                  <CardHeader className="border-b">
                    <CardTitle>{selectedProject.name}</CardTitle>
                    <CardDescription>
                      {formatPoints(selectedProject.points)} pts ·{' '}
                      {formatMoney(selectedProject.cost, selectedProject.currency)}
                      {selectedProject.unestimated_issues > 0
                        ? ` · ${selectedProject.unestimated_issues} unestimated`
                        : null}
                    </CardDescription>
                    <CardAction>
                      <Label className="font-normal text-muted-foreground">
                        Show done
                        <Switch
                          checked={showDone}
                          onCheckedChange={(checked) => setShowDone(checked)}
                        />
                      </Label>
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    <IssuesTable
                      issues={selectedProject.issues}
                      showDone={showDone}
                      showProject={false}
                      emptyMessage="No issues in this project."
                    />
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
