import type {
  AppSettingsOut,
  ConnectionTestOut,
  CycleOut,
  CycleSettingsIn,
  CycleSettingsOut,
  DataImportOut,
  GroupOut,
  IssueOut,
  LinearConfigOut,
  RefreshResult,
  TeamCostOut,
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

  listIssues: (teamId: number, cycleId?: number | null) =>
    request<IssueOut[]>(
      cycleId != null
        ? `/teams/${teamId}/issues?cycle_id=${cycleId}`
        : `/teams/${teamId}/issues`,
    ),
  getStats: (teamId: number, cycleId?: number | null) =>
    request<TeamStatsOut>(
      cycleId != null
        ? `/teams/${teamId}/stats?cycle_id=${cycleId}`
        : `/teams/${teamId}/stats`,
    ),

  listCycles: (teamId: number) => request<CycleOut[]>(`/teams/${teamId}/cycles`),
  getCycleSettings: (teamId: number, cycleId?: number | null) =>
    request<CycleSettingsOut>(
      cycleId != null
        ? `/teams/${teamId}/cycle?cycle_id=${cycleId}`
        : `/teams/${teamId}/cycle`,
    ),
  updateCycleSettings: (
    teamId: number,
    payload: CycleSettingsIn,
    cycleId?: number | null,
  ) =>
    request<CycleSettingsOut>(
      cycleId != null
        ? `/teams/${teamId}/cycle?cycle_id=${cycleId}`
        : `/teams/${teamId}/cycle`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
    ),
  finalizeCycle: (teamId: number) =>
    request<CycleSettingsOut>(`/teams/${teamId}/cycle/finalize`, {
      method: 'POST',
    }),

  getTeamCost: (teamId: number) => request<TeamCostOut>(`/teams/${teamId}/cost`),
  updateTeamCost: (teamId: number, payload: { currency: string; man_day_cost: number }) =>
    request<TeamCostOut>(`/teams/${teamId}/cost`, {
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

  downloadExport: async () => {
    const response = await fetch(`${BASE}/config/export`)
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
    const blob = await response.blob()
    const match = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')
    const filename = match?.[1] ?? 'engineering-efficiency-export.json'
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  },

  importData: async (file: File) => {
    let payload: unknown
    try {
      payload = JSON.parse(await file.text())
    } catch {
      throw new Error('This file is not valid JSON.')
    }
    return request<DataImportOut>('/config/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
}
