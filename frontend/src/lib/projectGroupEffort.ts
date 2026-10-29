import { workingDaysForPoints } from './projectSchedule.ts'

/** Issues with no assignee, or an assignee who is not in a known group. */
export const UNASSIGNED_GROUP_KEY = 'unassigned'
export const UNASSIGNED_GROUP_LABEL = 'Unassigned'

import { LinearStateType } from './issueState.ts'

export interface GroupEffortIssue {
  assigneeName: string | null
  stateType: string | null
  estimate: number | null
}

export interface GroupEffortMember {
  name: string
  groupId: number | null
}

export interface GroupEffortGroup {
  id: number
  name: string
  color: string | null
}

export interface GroupEffortSlice {
  key: string
  label: string
  color: string | null
  points: number
  days: number
}

export interface StackedGroupEffort extends GroupEffortSlice {
  x1: number
  x2: number
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function isCanceled(stateType: string | null): boolean {
  return stateType === LinearStateType.canceled
}

/**
 * Share of a project's estimated points by group.
 *
 * Each non-canceled issue's estimate is attributed to the assignee's group on
 * the current cycle. Canceled issues are skipped, matching project point
 * totals. Days are points ÷ 2. Named groups are alphabetical; unassigned is last.
 */
export function projectGroupEffort(
  issues: readonly GroupEffortIssue[],
  members: readonly GroupEffortMember[],
  groups: readonly GroupEffortGroup[],
): GroupEffortSlice[] {
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const groupIdByName = new Map<string, number | null>()
  for (const member of members) {
    const name = normalizeName(member.name)
    if (!name) continue
    const groupId =
      member.groupId != null && groupById.has(member.groupId) ? member.groupId : null
    const existing = groupIdByName.get(name)
    if (existing === undefined || (existing === null && groupId !== null)) {
      groupIdByName.set(name, groupId)
    }
  }

  const pointsByKey = new Map<string, number>()
  for (const issue of issues) {
    if (isCanceled(issue.stateType)) continue
    const estimate = issue.estimate
    if (estimate == null || !Number.isFinite(estimate) || estimate <= 0) continue
    const name = issue.assigneeName ? normalizeName(issue.assigneeName) : ''
    const groupId = name ? groupIdByName.get(name) : null
    const key =
      groupId != null && groupById.has(groupId) ? String(groupId) : UNASSIGNED_GROUP_KEY
    pointsByKey.set(key, (pointsByKey.get(key) ?? 0) + estimate)
  }

  const slices: GroupEffortSlice[] = []
  for (const [key, points] of pointsByKey) {
    if (points <= 0) continue
    const group = key === UNASSIGNED_GROUP_KEY ? null : groupById.get(Number(key))
    slices.push({
      key,
      label: group?.name ?? UNASSIGNED_GROUP_LABEL,
      color: group?.color ?? null,
      points,
      days: workingDaysForPoints(points),
    })
  }
  slices.sort(compareGroupEffort)
  return slices
}

export function compareGroupEffort(left: GroupEffortSlice, right: GroupEffortSlice): number {
  const leftUnassigned = left.key === UNASSIGNED_GROUP_KEY
  const rightUnassigned = right.key === UNASSIGNED_GROUP_KEY
  if (leftUnassigned !== rightUnassigned) return leftUnassigned ? 1 : -1
  return left.label.localeCompare(right.label) || left.key.localeCompare(right.key)
}

/** Place each group's days end to end, in `order`, so the segments form one line. */
export function stackGroupEffort(
  slices: readonly GroupEffortSlice[],
  order: readonly string[],
): StackedGroupEffort[] {
  const byKey = new Map(slices.map((slice) => [slice.key, slice]))
  const keys = [...order]
  for (const slice of slices) {
    if (!keys.includes(slice.key)) keys.push(slice.key)
  }
  const stacked: StackedGroupEffort[] = []
  let cursor = 0
  for (const key of keys) {
    const slice = byKey.get(key)
    if (!slice || slice.days <= 0) continue
    const x1 = cursor
    cursor += slice.days
    stacked.push({ ...slice, x1, x2: cursor })
  }
  return stacked
}
