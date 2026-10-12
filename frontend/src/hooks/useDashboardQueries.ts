import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { invalidateTeamData, queryKeys } from '../lib/queryKeys'
import { useSelectedCycleId } from '../lib/selection'

/** Teams, cycles, issues, stats, default cycle selection, and refresh. */
export function useDashboardQueries(selectedTeamId: number | null) {
  const queryClient = useQueryClient()

  const teamsQuery = useQuery({ queryKey: queryKeys.teams, queryFn: api.listTeams })

  const cyclesQuery = useQuery({
    queryKey: queryKeys.cycles(selectedTeamId),
    queryFn: () => api.listCycles(selectedTeamId as number),
    enabled: selectedTeamId !== null,
  })
  const cycles = cyclesQuery.data ?? []
  const [selectedCycleId, setSelectedCycleId] = useSelectedCycleId(cycles, selectedTeamId)

  const issuesQuery = useQuery({
    queryKey: queryKeys.issues(selectedTeamId, selectedCycleId),
    queryFn: () => api.listIssues(selectedTeamId as number, selectedCycleId),
    enabled: selectedTeamId !== null && selectedCycleId !== null,
  })

  const statsQuery = useQuery({
    queryKey: queryKeys.stats(selectedTeamId, selectedCycleId),
    queryFn: () => api.getStats(selectedTeamId as number, selectedCycleId),
    enabled: selectedTeamId !== null && selectedCycleId !== null,
  })

  const refreshMutation = useMutation({
    mutationFn: (teamId: number) => api.refreshTeam(teamId),
    onSuccess: (_result, teamId) => {
      invalidateTeamData(queryClient, teamId)
    },
  })

  return {
    teamsQuery,
    cyclesQuery,
    issuesQuery,
    statsQuery,
    refreshMutation,
    selectedCycleId,
    setSelectedCycleId,
  }
}
