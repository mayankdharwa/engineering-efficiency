import { useEffect, useState } from 'react'
import type { CycleOut } from '../types'

/** Keep the current team when it still exists; otherwise the first team. */
export function pickDefaultTeamId(
  teams: readonly { id: number }[],
  currentId: number | null,
): number | null {
  if (teams.length === 0) return currentId
  if (currentId !== null && teams.some((team) => team.id === currentId)) {
    return currentId
  }
  return teams[0].id
}

/** Keep the current cycle when it still exists; otherwise the current, else first. */
export function pickDefaultCycleId(
  cycles: readonly Pick<CycleOut, 'id' | 'is_current'>[],
  currentId: number | null,
): number | null {
  if (cycles.length === 0) return currentId
  if (currentId !== null && cycles.some((cycle) => cycle.id === currentId)) {
    return currentId
  }
  return cycles.find((cycle) => cycle.is_current)?.id ?? cycles[0].id
}

/**
 * Selected cycle id with the dashboard / cycle-config policy: current cycle,
 * else the first. Pass `resetKey` (usually the team id) to clear on team change.
 */
export function useSelectedCycleId(
  cycles: readonly CycleOut[],
  resetKey?: number | null,
) {
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null)

  useEffect(() => {
    setSelectedCycleId(null)
  }, [resetKey])

  useEffect(() => {
    const next = pickDefaultCycleId(cycles, selectedCycleId)
    if (next !== selectedCycleId) setSelectedCycleId(next)
  }, [cycles, selectedCycleId])

  return [selectedCycleId, setSelectedCycleId] as const
}
