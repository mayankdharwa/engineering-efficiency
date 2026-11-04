import { isoDateInTimeZone, isoDateToUtcMs, MS_PER_DAY } from './timezone.ts'

/** Calendar days after today to keep on the velocity trend x-axis. */
export const VELOCITY_TREND_LOOKAHEAD_DAYS = 5

function isoFromUtcMs(ms: number): string {
  const date = new Date(ms)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}-${day}`
}

function isWeekdayMs(ms: number): boolean {
  const weekday = new Date(ms).getUTCDay()
  return weekday !== 0 && weekday !== 6
}

/**
 * Weekday dates for the velocity trend x-axis: cycle start through
 * ``min(today + lookahead, cycle end)``, matching backend trend bucketing.
 */
export function velocityTrendWeekdayDates(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  timeZone: string,
  pointDates: string[],
  now: Date = new Date(),
  lookaheadDays: number = VELOCITY_TREND_LOOKAHEAD_DAYS,
): string[] {
  const sortedPoints = [...pointDates].sort()
  const startIso =
    sortedPoints[0] ?? (startsAt ? isoDateInTimeZone(startsAt, timeZone) : '')
  if (!startIso) return sortedPoints

  const startMs = isoDateToUtcMs(startIso)
  const todayMs = isoDateToUtcMs(isoDateInTimeZone(now.toISOString(), timeZone))
  if (startMs === null || todayMs === null) return sortedPoints

  let chartEndMs = todayMs + lookaheadDays * MS_PER_DAY
  if (endsAt) {
    const cycleEndMs = isoDateToUtcMs(isoDateInTimeZone(endsAt, timeZone))
    if (cycleEndMs !== null) chartEndMs = Math.min(chartEndMs, cycleEndMs)
  }

  if (chartEndMs < startMs) return sortedPoints

  const dates: string[] = []
  for (let cursor = startMs; cursor <= chartEndMs; cursor += MS_PER_DAY) {
    if (isWeekdayMs(cursor)) dates.push(isoFromUtcMs(cursor))
  }

  for (const date of sortedPoints) {
    if (!dates.includes(date)) dates.push(date)
  }
  dates.sort()
  return dates
}
