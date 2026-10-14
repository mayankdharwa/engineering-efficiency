/** Timezone-aware date helpers used across the dashboard.
 *
 * Instants are stored/served as UTC ISO strings. These helpers interpret them
 * in the working timezone configured in the app settings so calendar dates and
 * clock times match what the team actually sees. The IANA `timeZone` option of
 * `Intl.DateTimeFormat` handles DST correctly.
 */

/** Parse an ISO timestamp, treating a missing offset as UTC. */
function parseInstant(value: string): Date | null {
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

/** The date/time parts of an instant as seen in `timeZone`. */
function partsInTimeZone(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  return parts
}

/** Milliseconds `timeZone` is offset from UTC at the given instant. */
function offsetMs(date: Date, timeZone: string): number {
  const parts = partsInTimeZone(date, timeZone)
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - date.getTime()
}

/** The `YYYY-MM-DD` calendar date of an instant in `timeZone`. */
export function isoDateInTimeZone(value: string | null | undefined, timeZone: string): string {
  if (!value) return ''
  const date = parseInstant(value)
  if (!date) return ''
  const parts = partsInTimeZone(date, timeZone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** Parse a Linear calendar date (`YYYY-MM-DD`). */
export function parseIsoDate(
  value: string | null | undefined,
): { year: number; month: number; day: number } | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

const MS_PER_DAY = 86_400_000

/** Calendar dates of `targetDate` and today in `timeZone`, or ``null``. */
function dueAndToday(
  targetDate: string,
  timeZone: string,
  now: Date,
): { dueUtc: number; todayUtc: number } | null {
  const due = parseIsoDate(targetDate)
  const today = parseIsoDate(isoDateInTimeZone(now.toISOString(), timeZone))
  if (!due || !today) return null
  return {
    dueUtc: Date.UTC(due.year, due.month - 1, due.day),
    todayUtc: Date.UTC(today.year, today.month - 1, today.day),
  }
}

/** Weekdays after today in `timeZone` through `targetDate` (Mon–Fri).

Overdue dates return ``null``. A due date of today returns ``0``.
 */
export function weekdaysUntil(
  targetDate: string,
  timeZone: string,
  now: Date = new Date(),
): number | null {
  const bounds = dueAndToday(targetDate, timeZone, now)
  if (!bounds) return null
  const { dueUtc, todayUtc } = bounds
  if (dueUtc < todayUtc) return null
  let days = 0
  for (let cursor = todayUtc + MS_PER_DAY; cursor <= dueUtc; cursor += MS_PER_DAY) {
    const weekday = new Date(cursor).getUTCDay()
    if (weekday !== 0 && weekday !== 6) days += 1
  }
  return days
}

/** Calendar days `targetDate` is past today in `timeZone`.

A due date of today or later returns ``null``.
 */
export function calendarDaysLate(
  targetDate: string,
  timeZone: string,
  now: Date = new Date(),
): number | null {
  const bounds = dueAndToday(targetDate, timeZone, now)
  if (!bounds) return null
  const { dueUtc, todayUtc } = bounds
  if (todayUtc <= dueUtc) return null
  return Math.round((todayUtc - dueUtc) / MS_PER_DAY)
}

/** Convert a `YYYY-MM-DD` value (local midnight in `timeZone`) to a UTC ISO string. */
export function zonedDateToUtcIso(value: string, timeZone: string): string | null {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0)
  // Resolve the offset twice so DST transitions are handled.
  let instant = utcMidnight - offsetMs(new Date(utcMidnight), timeZone)
  instant = utcMidnight - offsetMs(new Date(instant), timeZone)
  return new Date(instant).toISOString()
}
