/** Role filter shared by the dashboard controls and the role-aware tables. */
export type RoleFilter = 'all' | 'DEV' | 'QA'

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
  cycle_id: string | null
  cycle_name: string | null
  cycle_number: number | null
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

export interface MemberMetricsOut {
  linear_id: string | null
  name: string
  email: string | null
  role: string | null
  counts_toward_capacity: boolean
  unavailable_days: number
  capacity_points: number
  taken_points: number
  done_points: number
  adhoc_points: number
  planned_points: number
  unestimated_count: number
  planning_efficiency: number | null
  velocity: number | null
  bandwidth_efficiency: number | null
}

export interface VelocityTrendPointOut {
  date: string
  progress: number
  done_points: number
  expected_points: number
  velocity: number | null
}

export interface RoleMetricsOut {
  role: string | null
  label: string
  members: number
  capacity_points: number
  taken_points: number
  done_points: number
  adhoc_points: number
  planned_points: number
  unestimated_count: number
  planning_efficiency: number | null
  velocity: number | null
  bandwidth_efficiency: number | null
  velocity_trend: VelocityTrendPointOut[]
}

export interface TeamStatsOut {
  team_id: number
  ready: boolean
  message: string | null
  cycle_id: string | null
  cycle_name: string | null
  cycle_number: number | null
  starts_at: string | null
  ends_at: string | null
  working_days: number
  default_working_days: number
  working_days_overridden: boolean
  points_per_day: number
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
  members: MemberMetricsOut[]
  roles: RoleMetricsOut[]
  velocity_trend: VelocityTrendPointOut[]
}

export interface CycleMemberOut {
  linear_id: string
  name: string
  email: string | null
  role: string | null
  unavailable_days: number
  counts_toward_capacity: boolean
}

export interface CycleSettingsOut {
  team_id: number
  ready: boolean
  message: string | null
  cycle_id: string | null
  cycle_name: string | null
  cycle_number: number | null
  starts_at: string | null
  ends_at: string | null
  working_days: number
  default_working_days: number
  working_days_overridden: boolean
  points_per_day: number
  members: CycleMemberOut[]
}

export interface CycleMemberAvailabilityIn {
  linear_id: string
  unavailable_days: number
  counts_toward_capacity?: boolean
  role?: string | null
}

export interface CycleSettingsIn {
  working_days?: number | null
  starts_at?: string | null
  ends_at?: string | null
  members?: CycleMemberAvailabilityIn[]
}
