import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { RefreshCwIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { api } from '../api'
import { IssuesTable } from '../components/IssuesTable'
import { ProjectCostChart } from '../components/ProjectCostChart'
import { ProjectDueDateTrajectory } from '../components/ProjectDueDateTrajectory'
import { ProjectStateFilter } from '../components/ProjectStateFilter'
import { ProjectsTable } from '../components/ProjectsTable'
import { TeamPicker } from '../components/TeamPicker'
import { useCanRefresh } from '../hooks/useAuth'
import { formatMoney, formatPoints, formatRelative } from '../lib/format'
import { notifyError, notifySuccess } from '../lib/notify'
import {
  DEFAULT_PROJECT_STATES,
  filterProjectsByState,
} from '../lib/projectState'
import { invalidateTeamData, queryKeys } from '../lib/queryKeys'
import { pickDefaultTeamId } from '../lib/selection'
import type { ProjectOut } from '../types'

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

export function ProjectsPage() {
  const queryClient = useQueryClient()
  const canRefresh = useCanRefresh()
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [selectedStates, setSelectedStates] = useState<Set<string>>(
    () => new Set(DEFAULT_PROJECT_STATES),
  )
  const [trajectoryStates, setTrajectoryStates] = useState<Set<string>>(
    () => new Set(DEFAULT_PROJECT_STATES),
  )
  const [costStates, setCostStates] = useState<Set<string>>(
    () => new Set(DEFAULT_PROJECT_STATES),
  )
  const [showDone, setShowDone] = useState(true)

  const teamsQuery = useQuery({ queryKey: queryKeys.teams, queryFn: api.listTeams })
  const teams = teamsQuery.data ?? []
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects(selectedTeamId),
    queryFn: () => api.listProjects(selectedTeamId as number),
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
  const selectedProject =
    visibleProjects.find((project) => project.id === selectedProjectId) ?? null

  const refreshMutation = useMutation({
    mutationFn: (teamId: number) => api.refreshProjects(teamId),
    onSuccess: (result, teamId) => {
      notifySuccess(result.message ?? `Synced ${result.projects_synced} project(s).`)
      invalidateTeamData(queryClient, teamId)
    },
    onError: (error: Error) => notifyError(error.message),
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
    onError: (error: Error) => notifyError(error.message),
  })

  useEffect(() => {
    const next = pickDefaultTeamId(teams, selectedTeamId)
    if (next !== selectedTeamId) setSelectedTeamId(next)
  }, [selectedTeamId, teams])

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
        <Card>
          <CardHeader>
            <CardTitle>No teams available</CardTitle>
            <CardDescription>Import teams in Settings first.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/config" className={buttonVariants()}>
              Go to Settings
            </Link>
          </CardContent>
        </Card>
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
                </p>
              )}
            </div>
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
                <CardTitle>No project data yet</CardTitle>
                <CardDescription>
                  Refresh this team to load its projects.
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
