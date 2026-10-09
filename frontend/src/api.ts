import type {
  AppSettingsOut,
  ConnectionTestOut,
  CycleSettingsIn,
  CycleSettingsOut,
  GroupOut,
  IssueOut,
  LinearConfigOut,
  RefreshResult,
  TeamOut,
  TeamStatsOut,
} from './types'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })

  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = (await response.json()) as { detail?: string }
      detail = body.detail ?? detail
    } catch {
      // response body was not JSON; keep the status text
    }
    throw new Error(detail || `Request failed (${response.status})`)
  }

  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export const api = {
  getConfig: () => request<LinearConfigOut>('/config'),
  saveConfig: (apiKey: string) =>
    request<LinearConfigOut>('/config', {
      method: 'PUT',
      body: JSON.stringify({ api_key: apiKey }),
    }),
  testConnection: () => request<ConnectionTestOut>('/config/test', { method: 'POST' }),

  getSettings: () => request<AppSettingsOut>('/settings'),
  updateSettings: (payload: { timezone: string; day_cutoff_hour: number }) =>
    request<AppSettingsOut>('/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  listTeams: () => request<TeamOut[]>('/teams'),
  importTeams: () => request<TeamOut[]>('/teams/import', { method: 'POST' }),
  refreshTeam: (teamId: number) =>
    request<RefreshResult>(`/teams/${teamId}/refresh`, { method: 'POST' }),
  deleteTeam: (teamId: number) =>
    request<void>(`/teams/${teamId}`, { method: 'DELETE' }),

  listIssues: (teamId: number) => request<IssueOut[]>(`/teams/${teamId}/issues`),
  getStats: (teamId: number) => request<TeamStatsOut>(`/teams/${teamId}/stats`),

  getCycleSettings: (teamId: number) =>
    request<CycleSettingsOut>(`/teams/${teamId}/cycle`),
  updateCycleSettings: (teamId: number, payload: CycleSettingsIn) =>
    request<CycleSettingsOut>(`/teams/${teamId}/cycle`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  listGroups: (teamId: number) => request<GroupOut[]>(`/teams/${teamId}/groups`),
  createGroup: (teamId: number, name: string) =>
    request<GroupOut>(`/teams/${teamId}/groups`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  renameGroup: (teamId: number, groupId: number, name: string) =>
    request<GroupOut>(`/teams/${teamId}/groups/${groupId}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),
  deleteGroup: (teamId: number, groupId: number) =>
    request<void>(`/teams/${teamId}/groups/${groupId}`, { method: 'DELETE' }),
}
