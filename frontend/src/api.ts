import type {
  AppSettingsOut,
  AuthStatusOut,
  ConnectionTestOut,
  CycleOut,
  CycleSettingsIn,
  CycleSettingsOut,
  DataImportOut,
  GroupOut,
  IssueOut,
  LinearConfigOut,
  ProjectOut,
  ProjectRefreshResult,
  RefreshResult,
  TeamCostOut,
  TeamOut,
  TeamStatsOut,
  UserOut,
} from './types'

const BASE = '/api'
const PUBLIC_AUTH_PATHS = new Set([
  '/auth/status',
  '/auth/setup',
  '/auth/login',
  '/auth/logout',
])

async function readErrorDetail(response: Response): Promise<string> {
  let detail = response.statusText
  try {
    const body = (await response.json()) as { detail?: string }
    detail = body.detail ?? detail
  } catch {
    // response body was not JSON; keep the status text
  }
  return detail || `Request failed (${response.status})`
}

function redirectToLogin() {
  if (window.location.pathname !== '/login') {
    window.location.assign('/login')
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (response.status === 401 && !PUBLIC_AUTH_PATHS.has(path)) {
    redirectToLogin()
  }

  if (!response.ok) {
    throw new Error(await readErrorDetail(response))
  }

  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export const api = {
  getAuthStatus: () => request<AuthStatusOut>('/auth/status'),
  setupAccount: (username: string, password: string) =>
    request<UserOut>('/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<UserOut>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),

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

  listProjects: (teamId: number) => request<ProjectOut[]>(`/teams/${teamId}/projects`),
  updateProject: (teamId: number, projectId: number, payload: { excluded: boolean }) =>
    request<ProjectOut>(`/teams/${teamId}/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  refreshProjects: (teamId: number) =>
    request<ProjectRefreshResult>(`/teams/${teamId}/projects/refresh`, {
      method: 'POST',
    }),

  getTeamCost: (teamId: number) => request<TeamCostOut>(`/teams/${teamId}/cost`),
  updateTeamCost: (teamId: number, payload: { currency: string; man_day_cost: number }) =>
    request<TeamCostOut>(`/teams/${teamId}/cost`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  listGroups: (teamId: number) => request<GroupOut[]>(`/teams/${teamId}/groups`),
  createGroup: (teamId: number, payload: { name: string; color?: string }) =>
    request<GroupOut>(`/teams/${teamId}/groups`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateGroup: (teamId: number, groupId: number, payload: { name: string; color?: string }) =>
    request<GroupOut>(`/teams/${teamId}/groups/${groupId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteGroup: (teamId: number, groupId: number) =>
    request<void>(`/teams/${teamId}/groups/${groupId}`, { method: 'DELETE' }),

  downloadExport: async () => {
    const response = await fetch(`${BASE}/config/export`, { credentials: 'include' })
    if (response.status === 401) {
      redirectToLogin()
    }
    if (!response.ok) {
      throw new Error(await readErrorDetail(response))
    }
    const blob = await response.blob()
    const match = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')
    const filename = match?.[1] ?? 'engineering-efficiency-export.zip'
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
    const response = await fetch(`${BASE}/config/import`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    })
    if (response.status === 401) {
      redirectToLogin()
    }
    if (!response.ok) {
      throw new Error(await readErrorDetail(response))
    }
    return (await response.json()) as DataImportOut
  },
}
