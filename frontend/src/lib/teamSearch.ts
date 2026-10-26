/** Team selection shared by Cycles, Projects, and Settings via `?team=`. */
export interface TeamSearch {
  team?: number
}

/** Keep a positive integer team id; drop anything else. */
export function parseTeamSearch(search: Record<string, unknown>): TeamSearch {
  const raw = search.team
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : Number.NaN
  if (!Number.isInteger(value) || value <= 0) return {}
  return { team: value }
}

export function teamIdFromSearch(search: { team?: unknown }): number | null {
  return parseTeamSearch({ team: search.team }).team ?? null
}
