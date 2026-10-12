import { RefreshCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCycle, formatDate, formatPoints, formatRelative } from '../lib/format'
import type { CycleOut, GroupOut, TeamOut, TeamStatsOut } from '../types'
import { CycleSelect } from './CycleSelect'
import { GroupFilterSelect } from './GroupFilterSelect'
import { TeamPicker } from './TeamPicker'

export function DashboardToolbar({
  teams,
  selectedTeam,
  selectedTeamId,
  onTeamChange,
  cycles,
  selectedCycleId,
  onCycleChange,
  groupOptions,
  selectedGroups,
  onGroupsChange,
  refreshPending,
  onRefresh,
  stats,
  timezone,
}: {
  teams: TeamOut[]
  selectedTeam: TeamOut | null
  selectedTeamId: number | null
  onTeamChange: (id: number | null) => void
  cycles: CycleOut[]
  selectedCycleId: number | null
  onCycleChange: (id: number | null) => void
  groupOptions: GroupOut[]
  selectedGroups: Set<string>
  onGroupsChange: (next: Set<string>) => void
  refreshPending: boolean
  onRefresh: () => void
  stats: TeamStatsOut | undefined
  timezone: string
}) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-64 shrink-0 sm:w-72">
          <TeamPicker
            teams={teams}
            value={selectedTeamId}
            onChange={onTeamChange}
            id="team-select"
            aria-label="Team"
          />
          {selectedTeam && (
            <p className="mt-2 text-xs text-muted-foreground">
              {selectedTeam.issue_count} current-cycle issue(s) · synced{' '}
              {formatRelative(selectedTeam.last_synced_at)}
            </p>
          )}
        </div>
        <CycleSelect
          cycles={cycles}
          value={selectedCycleId}
          onChange={onCycleChange}
          labelled={false}
        />
        <div className="w-44 shrink-0">
          <GroupFilterSelect
            groups={groupOptions}
            selected={selectedGroups}
            onChange={onGroupsChange}
          />
        </div>
        <Button
          type="button"
          disabled={selectedTeamId === null || refreshPending}
          onClick={onRefresh}
        >
          <RefreshCwIcon className={refreshPending ? 'animate-spin' : undefined} />
          {refreshPending ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {stats?.ready && (
        <div className="ml-auto text-right leading-tight">
          <div className="text-xl font-semibold tabular-nums">
            {formatCycle(stats.cycle_name, stats.cycle_number)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatDate(stats.starts_at, timezone)} → {formatDate(stats.ends_at, timezone)} ·{' '}
            {stats.working_days_overridden
              ? `${formatPoints(stats.working_days)} working days (adjusted)`
              : `${formatPoints(stats.working_days)} working days`}
          </div>
        </div>
      )}
    </div>
  )
}
