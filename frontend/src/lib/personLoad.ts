import { isCompletedState, LinearStateType } from './issueState.ts'

export interface PersonLoadIssue {
  assigneeName: string | null
  stateType: string | null
  estimate: number | null
}

export interface PersonLoadProjectInput {
  id: number
  name: string
  excluded: boolean
  state: string | null
  startDate: string | null
  targetDate: string | null
  issues: readonly PersonLoadIssue[]
}

export type PersonLoadRole = 'now' | 'next' | 'available'

export interface PersonLoadBar {
  key: string
  person: string
  projectId: number | null
  project: string
  role: PersonLoadRole
  done: number
  /** Completed plus remaining points. Canceled issues are omitted. */
  total: number
  remaining: number
  /** Open issues on this project with no estimate. */
  unestimated: number
  /** Queued projects that are not drawn after this next bar. */
  moreQueued: number
}

export interface CountedPerson {
  name: string
  groupName?: string | null
  groupColor?: string | null
}

export interface PersonLoadGroup {
  person: string
  groupName: string | null
  groupColor: string | null
  /** Remaining points on started projects. */
  nowRemaining: number
  bars: PersonLoadBar[]
}

interface ProjectSlice {
  projectId: number
  project: string
  startDate: string | null
  targetDate: string | null
  done: number
  remaining: number
  unestimated: number
  started: boolean
  open: boolean
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function isSkippedProject(state: string | null): boolean {
  const key = (state ?? '').trim().toLowerCase()
  return key === 'canceled' || key === 'completed'
}

function isCanceledIssue(stateType: string | null): boolean {
  return stateType === LinearStateType.canceled
}

/** Calendar prefix so datetime strings still sort as dates. Missing dates sort last. */
function compareDate(left: string | null, right: string | null): number {
  const a = dateSortKey(left)
  const b = dateSortKey(right)
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? -1 : 1
}

function dateSortKey(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed)
  return match?.[1] ?? trimmed
}

function compareName(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Started projects, then the single next project.
 *
 * Next is the open project with no started issues whose due date is soonest,
 * then start date, then name. Projects after that one stay off the chart;
 * `moreQueued` counts them.
 *
 * People are listed alphabetically. Someone with no open project work gets
 * one available row.
 */
export function buildPersonLoad(
  projects: readonly PersonLoadProjectInput[],
  countedPeople: readonly CountedPerson[],
): PersonLoadGroup[] {
  const displayName = new Map<string, string>()
  const groupName = new Map<string, string | null>()
  const groupColor = new Map<string, string | null>()
  const slicesByPerson = new Map<string, Map<number, ProjectSlice>>()
  for (const person of countedPeople) {
    const key = normalizeName(person.name)
    if (!key || slicesByPerson.has(key)) continue
    displayName.set(key, person.name.trim())
    groupName.set(key, person.groupName ?? null)
    groupColor.set(key, person.groupColor ?? null)
    slicesByPerson.set(key, new Map())
  }

  for (const project of projects) {
    if (project.excluded || isSkippedProject(project.state)) continue
    for (const issue of project.issues) {
      if (!issue.assigneeName) continue
      const personKey = normalizeName(issue.assigneeName)
      const slices = slicesByPerson.get(personKey)
      if (!slices || isCanceledIssue(issue.stateType)) continue
      const slice = slices.get(project.id) ?? {
        projectId: project.id,
        project: project.name,
        startDate: project.startDate,
        targetDate: project.targetDate,
        done: 0,
        remaining: 0,
        unestimated: 0,
        started: false,
        open: false,
      }
      slices.set(project.id, slice)
      const estimate = issue.estimate ?? 0
      if (isCompletedState(issue.stateType)) {
        slice.done += estimate
        continue
      }
      slice.open = true
      slice.remaining += estimate
      if (issue.estimate === null) slice.unestimated += 1
      if (issue.stateType === LinearStateType.started) slice.started = true
    }
  }

  const groups: PersonLoadGroup[] = []
  for (const [personKey, slices] of slicesByPerson) {
    const person = displayName.get(personKey) ?? personKey
    const open = [...slices.values()].filter((slice) => slice.open)
    const now = open.filter((slice) => slice.started)
    now.sort(
      (left, right) =>
        right.remaining - left.remaining || compareName(left.project, right.project),
    )
    const queued = open.filter((slice) => !slice.started)
    queued.sort(
      (left, right) =>
        compareDate(left.targetDate, right.targetDate) ||
        compareDate(left.startDate, right.startDate) ||
        compareName(left.project, right.project),
    )
    const next = queued[0]
    const bars: PersonLoadBar[] = now.map((slice) =>
      toBar(personKey, person, slice, 'now', 0),
    )
    if (next) bars.push(toBar(personKey, person, next, 'next', queued.length - 1))
    if (bars.length === 0) {
      bars.push({
        key: `${personKey}:available`,
        person,
        projectId: null,
        project: '',
        role: 'available',
        done: 0,
        total: 0,
        remaining: 0,
        unestimated: 0,
        moreQueued: 0,
      })
    }
    groups.push({
      person,
      groupName: groupName.get(personKey) ?? null,
      groupColor: groupColor.get(personKey) ?? null,
      nowRemaining: now.reduce((sum, slice) => sum + slice.remaining, 0),
      bars,
    })
  }

  groups.sort((left, right) => compareName(left.person, right.person))
  return groups
}

function toBar(
  personKey: string,
  person: string,
  slice: ProjectSlice,
  role: 'now' | 'next',
  moreQueued: number,
): PersonLoadBar {
  return {
    key: `${personKey}:${slice.projectId}`,
    person,
    projectId: slice.projectId,
    project: slice.project,
    role,
    done: slice.done,
    total: slice.done + slice.remaining,
    remaining: slice.remaining,
    unestimated: slice.unestimated,
    moreQueued,
  }
}

