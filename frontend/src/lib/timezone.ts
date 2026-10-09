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
