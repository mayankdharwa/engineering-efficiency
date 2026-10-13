import type { ProjectOut } from '../types'

/** Sentinel value for the "All states" option in the filter select. */
export const ALL_PROJECT_STATES_KEY = '__all__'

/** Linear project states, in the order they appear in the filter. */
export const PROJECT_STATES = [
  'backlog',
  'planned',
  'started',
  'paused',
  'completed',
  'canceled',
] as const

export type ProjectState = (typeof PROJECT_STATES)[number]

/** Filter key for a project with no Linear state. */
export const UNKNOWN_PROJECT_STATE = 'unknown'

/** Local status for projects excluded from calculations. */
export const EXCLUDED_PROJECT_STATE = 'excluded'

export const DEFAULT_PROJECT_STATES: ReadonlySet<string> = new Set(['started', 'completed'])

export function projectStateKey(state: string | null | undefined): string {
  if (!state || state.trim().length === 0) return UNKNOWN_PROJECT_STATE
  return state.trim().toLowerCase()
}

export function projectFilterKey(project: ProjectOut): string {
  if (project.excluded) return EXCLUDED_PROJECT_STATE
  return projectStateKey(project.state)
}

export function formatProjectState(state: string | null | undefined): string {
  const key = projectStateKey(state)
  if (key === UNKNOWN_PROJECT_STATE) return 'Unknown'
  if (key === EXCLUDED_PROJECT_STATE) return 'Excluded'
  return key.charAt(0).toUpperCase() + key.slice(1)
}

/** An empty selection means every state. */
export function isAllProjectStates(selected: Set<string>): boolean {
  return selected.size === 0
}

export function filterProjectsByState(
  projects: ProjectOut[],
  selected: Set<string>,
): ProjectOut[] {
  if (isAllProjectStates(selected)) return projects
  return projects.filter((project) => selected.has(projectFilterKey(project)))
}
