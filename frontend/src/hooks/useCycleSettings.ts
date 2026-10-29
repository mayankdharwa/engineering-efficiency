import { skipToken, useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { queryKeys } from '../lib/queryKeys'
import type { Scope } from '../lib/scope'

/** Cycle settings for a scope, or a disabled query when no team is selected. */
export function useCycleSettings(scope: Scope | null) {
  return useQuery({
    queryKey: queryKeys.cycle(scope),
    queryFn: scope === null ? skipToken : () => api.getCycleSettings(scope),
  })
}
