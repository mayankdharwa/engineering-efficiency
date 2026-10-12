/** Fallback when a cycle snapshot has not loaded yet. */
export const DEFAULT_POINTS_PER_DAY = 2

/** Convert estimate points into man-days at the team's points-per-day rate. */
export function pointsToManDays(points: number, pointsPerDay: number): number {
  return pointsPerDay === 0 ? 0 : points / pointsPerDay
}

/** Reference-line capacity for a full-time member over the cycle. */
export function fullCapacityPoints(workingDays: number, pointsPerDay: number): number {
  return workingDays * pointsPerDay
}
