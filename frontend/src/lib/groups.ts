import type { GroupMetricsOut, MemberMetricsOut, VelocityTrendPointOut } from '../types'

/** Sentinel value for the "All groups" option in the filter select. */
export const ALL_GROUPS_KEY = '__all__'
/** Filter key for members who are not assigned to any group. */
export const UNASSIGNED_KEY = 'unassigned'

/** Stable filter key for a group id (or the unassigned bucket). */
export function groupKey(groupId: number | null): string {
  return groupId === null ? UNASSIGNED_KEY : String(groupId)
}

/** An empty selection means "All groups". */
export function isAllGroups(selected: Set<string>): boolean {
  return selected.size === 0
}

export function filterMembers(
  members: MemberMetricsOut[],
  selected: Set<string>,
): MemberMetricsOut[] {
  if (isAllGroups(selected)) return members
  return members.filter((member) => selected.has(groupKey(member.group_id)))
}

export function selectGroups(
  groups: GroupMetricsOut[],
  selected: Set<string>,
): GroupMetricsOut[] {
  if (isAllGroups(selected)) return groups
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

/**
 * Combine several groups' precomputed totals into a single team-style summary
 * (ratios of summed totals, matching the backend's aggregation). The velocity
 * trend is summed per day so it lines up with the combined headline velocity.
 */
export function combineGroups(
  groups: GroupMetricsOut[],
  selected: Set<string>,
  progress: number,
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
    velocity: progress > 0 ? ratio(done, progress * taken) : null,
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
