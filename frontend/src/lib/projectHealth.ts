import { isProjectCompleted } from './projectState'

export const PROJECT_HEALTH = {
  on_track: 'On Track',
  lagging: 'Lagging',
  ahead: 'Ahead',
} as const

export type ProjectHealth = keyof typeof PROJECT_HEALTH

export function formatProjectHealth(health: string | null | undefined): string {
  if (!health) return '—'
  if (health in PROJECT_HEALTH) {
    return PROJECT_HEALTH[health as ProjectHealth]
  }
  return health
}

/** Ahead → On Track → Lagging → — (completed or no target date). */
export function projectHealthSortRank(project: {
  health: string | null
  state: string | null
}): number {
  if (isProjectCompleted(project.state)) return 3
  switch (project.health) {
    case 'ahead':
      return 0
    case 'on_track':
      return 1
    case 'lagging':
      return 2
    default:
      return 3
  }
}

export function projectHealthClassName(health: string | null | undefined): string {
  switch (health) {
    case 'on_track':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    case 'lagging':
      return 'bg-amber-500/10 text-amber-800 dark:text-amber-400'
    case 'ahead':
      return 'bg-sky-500/10 text-sky-700 dark:text-sky-400'
    default:
      return ''
  }
}
