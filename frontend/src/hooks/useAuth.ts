import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { queryKeys } from '../lib/queryKeys'

/** The signed-in user's auth status (shares the router guard's cache entry). */
export function useAuthStatus() {
  return useQuery({ queryKey: queryKeys.auth, queryFn: api.getAuthStatus })
}

/** Whether the current user may trigger a Linear refresh (admin or manager). */
export function useCanRefresh(): boolean {
  const { data } = useAuthStatus()
  return data?.role === 'admin' || data?.role === 'manager'
}
