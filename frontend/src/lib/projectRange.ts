/** How far back completed projects are included. One month is Recent Projects. */
export const PROJECT_RANGE_OPTIONS = [
  { value: 1, label: 'Recent Projects' },
  { value: 3, label: 'Last 3 months' },
  { value: 6, label: 'Last 6 months' },
  { value: 12, label: 'Last 12 months' },
] as const

export type ProjectRangeMonths = (typeof PROJECT_RANGE_OPTIONS)[number]['value']

export const DEFAULT_PROJECT_RANGE_MONTHS: ProjectRangeMonths = 1
