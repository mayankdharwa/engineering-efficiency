import { useSelectedTeam } from './useSelectedTeam'

/**
 * Selected team for the per-team Settings sections. The id lives in `?team=`,
 * the same param Cycles and Projects use, so switching sections or reloading
 * keeps the team.
 */
export function useConfigTeam() {
  const { teams, teamId, setTeamId } = useSelectedTeam()
  return { teams, teamId, setTeamId }
}
