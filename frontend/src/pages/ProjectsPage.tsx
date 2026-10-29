import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCwIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '../api'
import { NoTeamsCard } from '../components/NoTeamsCard'
import { PersonLoadSection } from '../components/PersonLoadSection'
import { ProjectCostSection } from '../components/ProjectCostSection'
import { ProjectDetailCard } from '../components/ProjectDetailCard'
import { ProjectDetailsSection } from '../components/ProjectDetailsSection'
import { ProjectRangeSelect } from '../components/ProjectRangeSelect'
import { ProjectSpanSection } from '../components/ProjectSpanSection'
import { ProjectStats } from '../components/ProjectStats'
import { ProjectTrajectorySection } from '../components/ProjectTrajectorySection'
import { TeamPicker } from '../components/TeamPicker'
import { useCanRefresh } from '../hooks/useAuth'
import { useSelectedTeam } from '../hooks/useSelectedTeam'
import { formatRelative } from '../lib/format'
import { notifySuccess } from '../lib/notify'
import { DEFAULT_PROJECT_RANGE_MONTHS, type ProjectRangeMonths } from '../lib/projectRange'
import {
  DEFAULT_PROJECT_STATES,
  filterProjectsByState,
} from '../lib/projectState'
import { invalidateTeamData, queryKeys } from '../lib/queryKeys'
import type { Scope } from '../lib/scope'
import type { ProjectOut } from '../types'

function NoProjectsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No projects in this range</CardTitle>
        <CardDescription>
          Choose a longer range, or refresh this team to load its projects.
        </CardDescription>
      </CardHeader>
    </Card>
  )
}

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
  const [completedWithinMonths, setCompletedWithinMonths] = useState<ProjectRangeMonths>(
    DEFAULT_PROJECT_RANGE_MONTHS,
  )

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects(selectedTeamId, completedWithinMonths),
    queryFn:
      selectedTeamId === null
        ? skipToken
        : () => api.listProjects(selectedTeamId, completedWithinMonths),
  })
  const scope: Scope | null = selectedTeamId === null ? null : { teamId: selectedTeamId }
  const projects = projectsQuery.data ?? []

  const visibleProjects = useMemo(
    () => filterProjectsByState(projects, selectedStates),
    [projects, selectedStates],
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
    mutationFn: ({ teamId, project }: { teamId: number; project: ProjectOut }) =>
      api.updateProject(teamId, project.id, { excluded: !project.excluded }),
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

  const lastSynced = projects.reduce<string | null>((latest, project) => {
    if (!project.last_synced_at) return latest
    if (!latest || project.last_synced_at > latest) return project.last_synced_at
    return latest
  }, null)

  const onToggleExcluded = (project: ProjectOut) => {
    if (selectedTeamId === null) return
    excludeMutation.mutate({ teamId: selectedTeamId, project })
  }
  const onSyncProject = canRefresh
    ? (project: ProjectOut) => {
        if (selectedTeamId === null) return
        syncProjectMutation.mutate({ teamId: selectedTeamId, projectId: project.id })
      }
    : undefined

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
            <NoProjectsCard />
          ) : (
            <>
              <ProjectStats projects={projects} />
              <ProjectDetailsSection
                projects={visibleProjects}
                selectedStates={selectedStates}
                onSelectedStatesChange={setSelectedStates}
                selectedProjectId={selectedProjectId}
                onSelect={(project) =>
                  setSelectedProjectId((current) =>
                    current === project.id ? null : project.id,
                  )
                }
                onToggleExcluded={onToggleExcluded}
                onSyncProject={onSyncProject}
              />
              <ProjectSpanSection projects={projects} scope={scope} />
              <ProjectTrajectorySection projects={projects} />
              <PersonLoadSection projects={projects} scope={scope} />
              <ProjectCostSection projects={projects} />
              {selectedProject && <ProjectDetailCard project={selectedProject} />}
            </>
          )}
        </>
      )}
    </div>
  )
}
