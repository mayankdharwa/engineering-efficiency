import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { APP_SETTINGS_QUERY_KEY } from '../lib/queryKeys'

export { APP_SETTINGS_QUERY_KEY }

export function useAppSettings() {
  return useQuery({ queryKey: APP_SETTINGS_QUERY_KEY, queryFn: api.getSettings })
}

/**
 * The configured working timezone, falling back to UTC while the settings load
 * (the backend default is also UTC, so there is no visible shift in that case).
 */
export function useTimezone(): string {
  const { data } = useAppSettings()
  return data?.timezone ?? 'UTC'
}
