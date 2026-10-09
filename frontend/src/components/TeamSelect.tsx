import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useConfigTeam } from '../hooks/useConfigTeam'

/** Shared team picker used by the per-team Configuration sections. */
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
      <Select
        items={teams.map((team) => ({
          label: `${team.name} (${team.key})`,
          value: team.id,
        }))}
        value={teamId}
        onValueChange={(value) => setTeamId(value as number | null)}
      >
        <SelectTrigger id="config-team" className="w-full">
          <SelectValue placeholder="Select a team" />
        </SelectTrigger>
        <SelectContent>
          {teams.map((team) => (
            <SelectItem key={team.id} value={team.id}>
              {team.name} ({team.key})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
