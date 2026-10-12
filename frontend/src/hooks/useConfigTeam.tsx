import { useQuery } from '@tanstack/react-query'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../api'
import { queryKeys } from '../lib/queryKeys'
import { pickDefaultTeamId } from '../lib/selection'
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
  const teamsQuery = useQuery({ queryKey: queryKeys.teams, queryFn: api.listTeams })
  const teams = teamsQuery.data ?? []
  const [teamId, setTeamId] = useState<number | null>(null)

  useEffect(() => {
    const next = pickDefaultTeamId(teams, teamId)
    if (next !== teamId) setTeamId(next)
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
