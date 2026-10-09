import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

/** Shared query key for the app-wide metric settings. */
export const APP_SETTINGS_QUERY_KEY = ['settings'] as const

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
