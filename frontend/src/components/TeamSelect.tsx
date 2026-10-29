import { Label } from '@/components/ui/label'
import { useSelectedTeam } from '../hooks/useSelectedTeam'
import { TeamPicker } from './TeamPicker'

/** Shared team picker used by the per-team Settings sections. */
export function TeamSelect() {
  const { teams, teamId, setTeamId } = useSelectedTeam()

  if (teams.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Import teams in Linear Setup first.
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
