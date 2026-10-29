import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { invalidateTeamData, queryKeys } from '../lib/queryKeys'
import type { Scope } from '../lib/scope'
import { useSelectedCycleId } from '../lib/selection'

/** Cycles, issues, stats, default cycle selection, and refresh for one team. */
export function useDashboardQueries(selectedTeamId: number | null) {
  const queryClient = useQueryClient()

  const cyclesQuery = useQuery({
    queryKey: queryKeys.cycles(selectedTeamId),
    queryFn: selectedTeamId === null ? skipToken : () => api.listCycles(selectedTeamId),
  })
  const cycles = cyclesQuery.data ?? []
  const [selectedCycleId, setSelectedCycleId] = useSelectedCycleId(cycles, selectedTeamId)

  const scope: Scope | null =
    selectedTeamId === null || selectedCycleId === null
      ? null
      : { teamId: selectedTeamId, cycleId: selectedCycleId }

  const issuesQuery = useQuery({
    queryKey: queryKeys.issues(scope),
    queryFn: scope === null ? skipToken : () => api.listIssues(scope),
  })

  const statsQuery = useQuery({
    queryKey: queryKeys.stats(scope),
    queryFn: scope === null ? skipToken : () => api.getStats(scope),
  })

  const refreshMutation = useMutation({
    mutationFn: (teamId: number) => api.refreshTeam(teamId),
    onSuccess: (_result, teamId) => {
      invalidateTeamData(queryClient, teamId)
    },
  })

  return {
    cyclesQuery,
    issuesQuery,
    statsQuery,
    refreshMutation,
    selectedCycleId,
    setSelectedCycleId,
  }
}
