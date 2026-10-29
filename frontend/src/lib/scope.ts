/** A team, optionally narrowed to a single cycle. */
export interface Scope {
  teamId: number
  /** A specific cycle; omitted means the team's current cycle. */
  cycleId?: number | null
}

/** Narrow a nullable scope, throwing if no team is selected. */
export function requireScope(scope: Scope | null): Scope {
  if (scope === null) throw new Error('No team selected.')
  return scope
}

/** Narrow a nullable team id, throwing if no team is selected. */
export function requireTeamId(teamId: number | null): number {
  if (teamId === null) throw new Error('No team selected.')
  return teamId
}
