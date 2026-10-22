import { DEFAULT_POINTS_PER_DAY } from './capacity.ts'
import { parseIsoDate } from './timezone.ts'

const MS_PER_DAY = 86_400_000

function utcMidnight(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day)
}

function isWeekday(ms: number): boolean {
  const weekday = new Date(ms).getUTCDay()
  return weekday !== 0 && weekday !== 6
}

function isoFromUtc(ms: number): string {
  const date = new Date(ms)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}-${day}`
}

/** Working days of effort for `points` at `pointsPerDay` (default 2 points per day). */
export function workingDaysForPoints(
  points: number,
  pointsPerDay: number = DEFAULT_POINTS_PER_DAY,
): number {
  if (!Number.isFinite(points) || pointsPerDay <= 0) return 0
  return Math.max(0, points) / pointsPerDay
}

/**
 * Last working day of an effort that starts on `startDate` and lasts
 * `workingDays`.
 *
 * The start date is day one when it is a weekday; a weekend start begins on
 * the following Monday. A fractional day finishes on the working day that
 * contains the remainder. Zero duration returns the start date unchanged.
 */
export function addWorkingDays(startDate: string, workingDays: number): string | null {
  const start = parseIsoDate(startDate)
  if (!start || !Number.isFinite(workingDays)) return null
  let cursor = utcMidnight(start.year, start.month, start.day)
  if (workingDays <= 0) return isoFromUtc(cursor)

  while (!isWeekday(cursor)) cursor += MS_PER_DAY

  let remaining = workingDays
  while (remaining > 1 + 1e-9) {
    remaining -= 1
    cursor += MS_PER_DAY
    while (!isWeekday(cursor)) cursor += MS_PER_DAY
  }
  return isoFromUtc(cursor)
}

/** Calculated due date: start date plus the working days implied by `points`. */
export function calculatedProjectDueDate(
  startDate: string | null | undefined,
  points: number,
): string | null {
  if (!startDate) return null
  return addWorkingDays(startDate, workingDaysForPoints(points))
}

/**
 * Signed working-day distance from `fromDate` to `toDate`.
 *
 * Positive when `toDate` is later. The same calendar day is 0. Weekends are
 * not counted, matching the gap between two due dates in working days.
 */
export function signedWorkingDaysBetween(
  fromDate: string,
  toDate: string,
): number | null {
  const from = parseIsoDate(fromDate)
  const to = parseIsoDate(toDate)
  if (!from || !to) return null
  const fromMs = utcMidnight(from.year, from.month, from.day)
  const toMs = utcMidnight(to.year, to.month, to.day)
  if (fromMs === toMs) return 0
  const step = toMs > fromMs ? 1 : -1
  let days = 0
  for (
    let cursor = fromMs + step * MS_PER_DAY;
    step > 0 ? cursor <= toMs : cursor >= toMs;
    cursor += step * MS_PER_DAY
  ) {
    if (isWeekday(cursor)) days += step
  }
  return days
}

/**
 * Weekdays from `startDate` through `dueDate`, counting a weekday endpoint.
 *
 * This is the effort that finishes on `dueDate` when work starts on
 * `startDate`, matching `addWorkingDays`. The same weekday spans 1. A weekend
 * adds nothing, so Saturday through Sunday is 0. The result is negative when
 * the due date is earlier than the start date.
 */
export function workingDaysThrough(startDate: string, dueDate: string): number | null {
  const start = parseIsoDate(startDate)
  const due = parseIsoDate(dueDate)
  if (!start || !due) return null
  const startMs = utcMidnight(start.year, start.month, start.day)
  const dueMs = utcMidnight(due.year, due.month, due.day)
  const earlier = Math.min(startMs, dueMs)
  const later = Math.max(startMs, dueMs)
  let days = 0
  for (let cursor = earlier; cursor <= later; cursor += MS_PER_DAY) {
    if (isWeekday(cursor)) days += 1
  }
  if (days === 0 || dueMs >= startMs) return days
  return -days
}

/**
 * Working days the calculated due date is off from the Linear due date.
 * Positive means the estimate lands later than the Linear date.
 */
export function dueDateOffsetWorkingDays(
  calculatedDueDate: string | null,
  actualDueDate: string | null | undefined,
): number | null {
  if (!calculatedDueDate || !actualDueDate) return null
  return signedWorkingDaysBetween(actualDueDate, calculatedDueDate)
}

/** `+2 days`, `-5 days`, or `0 days`. */
export function formatWorkingDayOffset(days: number): string {
  const unit = Math.abs(days) === 1 ? 'day' : 'days'
  if (days > 0) return `+${days} ${unit}`
  return `${days} ${unit}`
}