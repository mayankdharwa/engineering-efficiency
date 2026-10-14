import type { QueryClient } from '@tanstack/react-query'

/** Shared query key for the app-wide metric settings. */
export const APP_SETTINGS_QUERY_KEY = ['settings'] as const

function withOptionalCycle<TPrefix extends string>(
  prefix: TPrefix,
  teamId: number | null,
  cycleId?: number | null,
) {
  return cycleId === undefined
    ? ([prefix, teamId] as const)
    : ([prefix, teamId, cycleId] as const)
}

export const queryKeys = {
  auth: ['auth'] as const,
  teams: ['teams'] as const,
  config: ['config'] as const,
  settings: APP_SETTINGS_QUERY_KEY,
  cycles: (teamId: number | null) => ['cycles', teamId] as const,
  cycle: (teamId: number | null, cycleId?: number | null) =>
    withOptionalCycle('cycle', teamId, cycleId),
  issues: (teamId: number | null, cycleId?: number | null) =>
    withOptionalCycle('issues', teamId, cycleId),
  stats: (teamId: number | null, cycleId?: number | null) =>
    withOptionalCycle('stats', teamId, cycleId),
  /** Prefix matching every team's stats (e.g. after timezone changes). */
  allStats: ['stats'] as const,
  groups: (teamId: number | null) => ['groups', teamId] as const,
  teamCost: (teamId: number | null) => ['team-cost', teamId] as const,
  projects: (teamId: number | null) => ['projects', teamId] as const,
}

function teamScopedKeys(teamId: number) {
  return [
    queryKeys.issues(teamId),
    queryKeys.cycles(teamId),
    queryKeys.cycle(teamId),
    queryKeys.stats(teamId),
    queryKeys.groups(teamId),
    queryKeys.teamCost(teamId),
    queryKeys.projects(teamId),
  ]
}

/**
 * Invalidate (or remove) every cache entry that depends on one team.
 * Prefix-matching is unchanged: keys omit the cycle id so all cycles match.
 */
export function invalidateTeamData(
  queryClient: QueryClient,
  teamId: number,
  options?: { remove?: boolean },
) {
  queryClient.invalidateQueries({ queryKey: queryKeys.teams })
  for (const queryKey of teamScopedKeys(teamId)) {
    if (options?.remove) {
      queryClient.removeQueries({ queryKey })
    } else {
      queryClient.invalidateQueries({ queryKey })
    }
  }
}
