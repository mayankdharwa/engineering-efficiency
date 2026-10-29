import type { FilterSelection } from './filterSelection'
import { isAllSelected } from './filterSelection'
import type {
  AdhocByDayPointOut,
  GroupMetricsOut,
  MemberMetricsOut,
  VelocityTrendPointOut,
} from '../types'

/** Sentinel value for the "All groups" option in the filter select. */
export const ALL_GROUPS_KEY = '__all__'
/** Filter key / Select sentinel for members who are not assigned to any group. */
export const UNASSIGNED_KEY = 'unassigned'

/** Stable filter key for a group id (or the unassigned bucket). */
export function groupKey(groupId: number | null): string {
  return groupId === null ? UNASSIGNED_KEY : String(groupId)
}

export function filterMembers(
  members: MemberMetricsOut[],
  selected: FilterSelection,
): MemberMetricsOut[] {
  if (isAllSelected(selected)) return members
  return members.filter((member) => selected.has(groupKey(member.group_id)))
}

/** Keep adhoc-by-day slices whose assignee belongs to the selected groups. */
export function filterAdhocByDay(
  points: AdhocByDayPointOut[],
  selected: FilterSelection,
): AdhocByDayPointOut[] {
  if (isAllSelected(selected)) return points
  return points.filter((point) => selected.has(groupKey(point.group_id)))
}

export function selectGroups(
  groups: GroupMetricsOut[],
  selected: FilterSelection,
): GroupMetricsOut[] {
  if (isAllSelected(selected)) return groups
  return groups.filter((group) => selected.has(groupKey(group.group_id)))
}

export interface GroupSummary {
  planning: number | null
  velocity: number | null
  bandwidth: number | null
  planned: number
  taken: number
  done: number
  capacity: number
  adhoc: number
  unestimated: number
  trend: VelocityTrendPointOut[]
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null
}

/** Expected done points: 2 per day the member should have been working. */
function memberExpectedPoints(
  member: MemberMetricsOut,
  workingDays: number,
  elapsed: number,
  pointsPerDay: number,
): number {
  const available = Math.max(workingDays - member.unavailable_days, 0)
  if (available <= 0) return 0
  return pointsPerDay * Math.min(Math.max(elapsed, 0), available)
}

/**
 * Combine several groups' precomputed totals into a single team-style summary
 * (ratios of summed totals, matching the backend's aggregation). Velocity uses
 * each member's time-based expected points. The trend is summed per day
 * so it lines up with the combined headline velocity.
 */
export function combineGroups(
  groups: GroupMetricsOut[],
  selected: Set<string>,
  members: MemberMetricsOut[],
  workingDays: number,
  elapsed: number,
  pointsPerDay: number,
): GroupSummary {
  const chosen = selectGroups(groups, selected)
  const total = (pick: (group: GroupMetricsOut) => number) =>
    chosen.reduce((sum, group) => sum + pick(group), 0)

  const taken = total((group) => group.taken_points)
  const done = total((group) => group.done_points)
  const planned = total((group) => group.planned_points)
  const capacity = total((group) => group.capacity_points)
  const adhoc = total((group) => group.adhoc_points)
  const unestimated = total((group) => group.unestimated_count)
  const expected = filterMembers(members, selected).reduce(
    (sum, member) => sum + memberExpectedPoints(member, workingDays, elapsed, pointsPerDay),
    0,
  )

  const trendByDate = new Map<
    string,
    { progress: number; done: number; expected: number }
  >()
  for (const group of chosen) {
    for (const point of group.velocity_trend) {
      const bucket = trendByDate.get(point.date) ?? {
        progress: point.progress,
        done: 0,
        expected: 0,
      }
      bucket.done += point.done_points
      bucket.expected += point.expected_points
      trendByDate.set(point.date, bucket)
    }
  }
  const trend = [...trendByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({
      date,
      progress: value.progress,
      done_points: value.done,
      expected_points: value.expected,
      velocity: ratio(value.done, value.expected),
    }))

  return {
    planning: ratio(planned, taken),
    velocity: ratio(done, expected),
    bandwidth: ratio(taken, capacity),
    planned,
    taken,
    done,
    capacity,
    adhoc,
    unestimated,
    trend,
  }
}
