import { useQuery } from '@tanstack/react-query'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../api'
import type { TeamOut } from '../types'

interface ConfigTeamContextValue {
  teams: TeamOut[]
  teamId: number | null
  setTeamId: (id: number | null) => void
}

const ConfigTeamContext = createContext<ConfigTeamContextValue | null>(null)

/**
 * Shares one selected team across the per-team Configuration sections
 * (Cycle Configuration, Groups, Team Configuration) so switching sections keeps
 * the same team.
 */
export function ConfigTeamProvider({ children }: { children: ReactNode }) {
  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: api.listTeams })
  const teams = teamsQuery.data ?? []
  const [teamId, setTeamId] = useState<number | null>(null)

  useEffect(() => {
    if (teams.length === 0) return
    // Fall back to the first team when nothing is selected or the selected
    // team no longer exists (e.g. it was just deleted).
    if (teamId === null || !teams.some((team) => team.id === teamId)) {
      setTeamId(teams[0].id)
    }
  }, [teamId, teams])

  return (
    <ConfigTeamContext.Provider value={{ teams, teamId, setTeamId }}>
      {children}
    </ConfigTeamContext.Provider>
  )
}

export function useConfigTeam(): ConfigTeamContextValue {
  const context = useContext(ConfigTeamContext)
  if (context === null) {
    throw new Error('useConfigTeam must be used within a ConfigTeamProvider')
  }
  return context
}
