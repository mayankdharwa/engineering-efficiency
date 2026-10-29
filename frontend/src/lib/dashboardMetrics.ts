import type {
  AdhocByDayPointOut,
  GroupOut,
  MemberMetricsOut,
  TeamStatsOut,
  VelocityTrendPointOut,
} from '../types'
import {
  DEFAULT_POINTS_PER_DAY,
  fullCapacityPoints,
  pointsToManDays,
} from './capacity'
import { combineGroups, filterAdhocByDay, filterMembers } from './groups'
import { isAllSelected } from './filterSelection'

/** Headline totals shown on the dashboard cards (team or selected groups). */
export interface DashboardHeadline {
  planning: number | null
  velocity: number | null
  bandwidth: number | null
  planned: number
  taken: number
  done: number
  capacity: number
  adhoc: number
  unestimated: number
}

export interface DashboardCosts {
  manDayCost: number
  currency: string
  adhocCost: number
  unutilizedPoints: number
  unutilizedCost: number
}

export interface DashboardView {
  summary: DashboardHeadline
  velocityTrend: VelocityTrendPointOut[]
  chartMembers: MemberMetricsOut[]
  adhocDates: string[]
  adhocByDay: AdhocByDayPointOut[]
  groupOptions: GroupOut[]
  costs: DashboardCosts
  pointsPerDay: number
  fullCapacityPoints: number
}

function emptyHeadline(): DashboardHeadline {
  return {
    planning: null,
    velocity: null,
    bandwidth: null,
    planned: 0,
    taken: 0,
    done: 0,
    capacity: 0,
    adhoc: 0,
    unestimated: 0,
  }
}

function headlineFromStats(stats: TeamStatsOut): DashboardHeadline {
  return {
    planning: stats.planning_efficiency,
    velocity: stats.velocity,
    bandwidth: stats.bandwidth_efficiency,
    planned: stats.total_planned_points,
    taken: stats.total_taken_points,
    done: stats.total_done_points,
    capacity: stats.total_capacity_points,
    adhoc: stats.total_adhoc_points,
    unestimated: stats.unestimated_issues,
  }
}

export function buildDashboardView(
  stats: TeamStatsOut | undefined,
  selectedGroups: Set<string>,
): DashboardView {
  const pointsPerDay = stats?.points_per_day ?? DEFAULT_POINTS_PER_DAY
  const workingDays = stats?.working_days ?? 0
  const groupSummary =
    stats && !isAllSelected(selectedGroups)
      ? combineGroups(
          stats.groups,
          selectedGroups,
          stats.members,
          stats.working_days,
          stats.progress * stats.working_days,
          pointsPerDay,
        )
      : null

  const summary: DashboardHeadline = groupSummary
    ? {
        planning: groupSummary.planning,
        velocity: groupSummary.velocity,
        bandwidth: groupSummary.bandwidth,
        planned: groupSummary.planned,
        taken: groupSummary.taken,
        done: groupSummary.done,
        capacity: groupSummary.capacity,
        adhoc: groupSummary.adhoc,
        unestimated: groupSummary.unestimated,
      }
    : stats
      ? headlineFromStats(stats)
      : emptyHeadline()

  const manDayCost = stats?.man_day_cost ?? 0
  const currency = stats?.currency ?? '$'
  const unutilizedPoints = Math.max(0, summary.capacity - summary.taken)

  return {
    summary,
    velocityTrend: groupSummary ? groupSummary.trend : (stats?.velocity_trend ?? []),
    chartMembers: filterMembers(stats?.members ?? [], selectedGroups),
    adhocDates: stats?.adhoc_dates ?? [],
    adhocByDay: filterAdhocByDay(stats?.adhoc_by_day ?? [], selectedGroups),
    groupOptions: (stats?.groups ?? [])
      .filter((group) => group.group_id !== null)
      .map((group) => ({
        id: group.group_id as number,
        name: group.label,
        color: group.color ?? '',
      })),
    costs: {
      manDayCost,
      currency,
      adhocCost: pointsToManDays(summary.adhoc, pointsPerDay) * manDayCost,
      unutilizedPoints,
      unutilizedCost: pointsToManDays(unutilizedPoints, pointsPerDay) * manDayCost,
    },
    pointsPerDay,
    fullCapacityPoints: fullCapacityPoints(workingDays, pointsPerDay),
  }
}
