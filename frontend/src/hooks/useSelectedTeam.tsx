import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  type ReactNode,
} from 'react'
import { api } from '../api'
import { queryKeys } from '../lib/queryKeys'
import { pickDefaultTeamId } from '../lib/selection'
import { teamIdFromSearch } from '../lib/teamSearch'
import type { TeamOut } from '../types'

interface SelectedTeamContextValue {
  teams: TeamOut[]
  teamsQuery: UseQueryResult<TeamOut[]>
  teamId: number | null
  setTeamId: (id: number | null) => void
  selectedTeam: TeamOut | null
}

const SelectedTeamContext = createContext<SelectedTeamContextValue | null>(null)

/**
 * Selected team for the authenticated app, stored in `?team=` so a reload
 * keeps the same team and Cycles, Projects, and Settings stay in sync.
 */
export function SelectedTeamProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const teamId = useRouterState({
    select: (state) => teamIdFromSearch(state.location.search),
  })
  const teamsQuery = useQuery({ queryKey: queryKeys.teams, queryFn: api.listTeams })
  const teams = teamsQuery.data ?? []
  const selectedTeam = teams.find((team) => team.id === teamId) ?? null

  useEffect(() => {
    if (!teamsQuery.isSuccess || !teamsQuery.data) return
    const next = pickDefaultTeamId(teamsQuery.data, teamId)
    if (next === null || next === teamId) return
    void navigate({
      to: '.',
      search: (prev) => ({ ...prev, team: next }),
      replace: true,
    })
  }, [navigate, teamId, teamsQuery.data, teamsQuery.isSuccess])

  const setTeamId = useCallback(
    (id: number | null) => {
      if (id === teamId) return
      void navigate({
        to: '.',
        search: (prev) => ({ ...prev, team: id ?? undefined }),
      })
    },
    [navigate, teamId],
  )

  return (
    <SelectedTeamContext.Provider
      value={{ teams, teamsQuery, teamId, setTeamId, selectedTeam }}
    >
      {children}
    </SelectedTeamContext.Provider>
  )
}

export function useSelectedTeam(): SelectedTeamContextValue {
  const context = useContext(SelectedTeamContext)
  if (context === null) {
    throw new Error('useSelectedTeam must be used within a SelectedTeamProvider')
  }
  return context
}
