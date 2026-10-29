import type { QueryClient } from '@tanstack/react-query'
import type { Scope } from './scope'

/** Shared query key for the app-wide metric settings. */
export const APP_SETTINGS_QUERY_KEY = ['settings'] as const

/** Team + optional cycle key; a null scope marks a disabled query. */
function scopeKey<TPrefix extends string>(prefix: TPrefix, scope: Scope | null) {
  if (scope === null) return [prefix, null] as const
  return scope.cycleId == null
    ? ([prefix, scope.teamId] as const)
    : ([prefix, scope.teamId, scope.cycleId] as const)
}

export const queryKeys = {
  auth: ['auth'] as const,
  users: ['users'] as const,
  teams: ['teams'] as const,
  config: ['config'] as const,
  settings: APP_SETTINGS_QUERY_KEY,
  cycles: (teamId: number | null) => ['cycles', teamId] as const,
  cycle: (scope: Scope | null) => scopeKey('cycle', scope),
  issues: (scope: Scope | null) => scopeKey('issues', scope),
  stats: (scope: Scope | null) => scopeKey('stats', scope),
  /** Prefix matching every team's stats (e.g. after timezone changes). */
  allStats: ['stats'] as const,
  groups: (teamId: number | null) => ['groups', teamId] as const,
  teamCost: (teamId: number | null) => ['team-cost', teamId] as const,
  /** Omit the range to match every cached window for one team. */
  projects: (teamId: number | null, completedWithinMonths?: number) =>
    completedWithinMonths === undefined
      ? (['projects', teamId] as const)
      : (['projects', teamId, completedWithinMonths] as const),
}

function teamScopedKeys(teamId: number) {
  const scope: Scope = { teamId }
  return [
    queryKeys.issues(scope),
    queryKeys.cycles(teamId),
    queryKeys.cycle(scope),
    queryKeys.stats(scope),
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
