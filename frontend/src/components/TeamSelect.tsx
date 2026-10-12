import { Label } from '@/components/ui/label'
import { useConfigTeam } from '../hooks/useConfigTeam'
import { TeamPicker } from './TeamPicker'

/** Shared team picker used by the per-team Settings sections. */
export function TeamSelect() {
  const { teams, teamId, setTeamId } = useConfigTeam()

  if (teams.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Import teams from Linear in <strong>Linear Setup</strong> first.
      </p>
    )
  }

  return (
    <div className="max-w-xs space-y-2">
      <Label htmlFor="config-team">Team</Label>
      <TeamPicker teams={teams} value={teamId} onChange={setTeamId} id="config-team" />
    </div>
  )
}
