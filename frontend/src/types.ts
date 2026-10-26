export type UserRole = 'admin' | 'manager' | 'reader'

export interface AuthStatusOut {
  authenticated: boolean
  setup_required: boolean
  username: string | null
  role: UserRole | null
}

export interface UserOut {
  id: number
  username: string
  role: UserRole
}

export interface GroupOut {
  id: number
  name: string
  color: string
}

export interface LinearConfigOut {
  configured: boolean
  viewer_name: string | null
  viewer_email: string | null
  organization_name: string | null
  updated_at: string | null
}

export interface ConnectionTestOut {
  ok: boolean
  message: string
  viewer_name: string | null
  organization_name: string | null
}

export interface AppSettingsOut {
  timezone: string
  day_cutoff_hour: number
}

export interface TeamOut {
  id: number
  linear_id: string
  key: string
  name: string
  description: string | null
  color: string | null
  issue_count: number
  last_synced_at: string | null
}

export interface IssueOut {
  id: number
  identifier: string
  title: string
  state_name: string | null
  state_type: string | null
  estimate: number | null
  assignee_name: string | null
  project_name: string | null
  cycle_id: number | null
  labels: string[]
  created_at: string | null
  completed_at: string | null
}

export interface RefreshResult {
  team_id: number
  status: string
  issues_synced: number
  members_synced: number
  cycle_name: string | null
  message: string | null
}

/** Shared point totals and ratios used by member and group metric rows. */
export interface PointMetrics {
  capacity_points: number
  taken_points: number
  done_points: number
  adhoc_points: number
  planned_points: number
  expected_points: number
  unestimated_count: number
  planning_efficiency: number | null
  velocity: number | null
  bandwidth_efficiency: number | null
}

export interface MemberMetricsOut extends PointMetrics {
  linear_id: string | null
  name: string
  email: string | null
  group_id: number | null
  group_name: string | null
  group_color: string | null
  counts_toward_capacity: boolean
  unavailable_days: number
}

export interface VelocityTrendPointOut {
  date: string
  progress: number
  done_points: number
  expected_points: number
  velocity: number | null
}

export interface AdhocByDayPointOut {
  date: string
  assignee: string
  linear_id: string | null
  group_id: number | null
  points: number
}

export interface GroupMetricsOut extends PointMetrics {
  group_id: number | null
  label: string
  color: string | null
  members: number
  velocity_trend: VelocityTrendPointOut[]
}

/** Shared cycle header fields used by stats and cycle settings. */
export interface CycleSnapshot {
  team_id: number
  /** Cycle snapshot is loaded. */
  ready: boolean
  message: string | null
  cycle_id: number | null
  cycle_linear_id: string | null
  cycle_name: string | null
  cycle_number: number | null
  starts_at: string | null
  ends_at: string | null
  working_days: number
  default_working_days: number
  working_days_overridden: boolean
  points_per_day: number
}

export interface TeamStatsOut extends CycleSnapshot {
  /** Elapsed working-day fraction 0..1. */
  progress: number
  total_taken_points: number
  total_done_points: number
  total_adhoc_points: number
  total_planned_points: number
  total_capacity_points: number
  unestimated_issues: number
  planning_efficiency: number | null
  velocity: number | null
  bandwidth_efficiency: number | null
  currency: string
  man_day_cost: number
  members: MemberMetricsOut[]
  groups: GroupMetricsOut[]
  velocity_trend: VelocityTrendPointOut[]
  adhoc_dates: string[]
  adhoc_by_day: AdhocByDayPointOut[]
}

export interface CycleMemberOut {
  linear_id: string
  name: string
  email: string | null
  group_id: number | null
  group_name: string | null
  unavailable_days: number
  counts_toward_capacity: boolean
}

export interface CycleOut {
  id: number
  linear_id: string
  name: string | null
  number: number | null
  starts_at: string | null
  ends_at: string | null
  archived_at: string | null
  is_current: boolean
}

export interface CycleSettingsOut extends CycleSnapshot {
  archived_at: string | null
  is_current: boolean
  groups: GroupOut[]
  members: CycleMemberOut[]
}

export interface TeamCostOut {
  team_id: number
  currency: string
  man_day_cost: number
}

export interface CycleMemberAvailabilityIn {
  linear_id: string
  unavailable_days: number
  counts_toward_capacity?: boolean
  group_id?: number | null
}

export interface CycleSettingsIn {
  working_days?: number | null
  starts_at?: string | null
  ends_at?: string | null
  members?: CycleMemberAvailabilityIn[]
}

export interface DataImportOut {
  ok: boolean
  teams: number
  cycles: number
  issues: number
  members: number
  projects: number
}

export interface ProjectIssueOut {
  id: number
  identifier: string
  title: string
  state_name: string | null
  state_type: string | null
  estimate: number | null
  assignee_name: string | null
  created_at: string | null
  completed_at: string | null
}

export interface ProjectDueDateChangeOut {
  changed_at: string
  from_date: string | null
  to_date: string | null
  from_activity: boolean
}

export interface ProjectOut {
  id: number
  linear_id: string
  name: string
  state: string | null
  start_date: string | null
  target_date: string | null
  completed_at: string | null
  canceled_at: string | null
  archived_at: string | null
  last_synced_at: string | null
  excluded: boolean
  issue_count: number
  points: number
  done_points: number
  unestimated_issues: number
  incurred_cost: number
  cost: number
  currency: string
  man_day_cost: number
  health: 'on_track' | 'lagging' | 'ahead' | null
  expected_done_points: number | null
  working_days_left: number | null
  due_date_history: ProjectDueDateChangeOut[]
  issues: ProjectIssueOut[]
}

export interface ProjectRefreshResult {
  team_id: number
  status: string
  projects_synced: number
  issues_synced: number
  projects_skipped: number
  message: string | null
}
