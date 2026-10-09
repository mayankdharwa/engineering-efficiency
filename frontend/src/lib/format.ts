export function formatDateTime(
  value: string | null | undefined,
  timeZone?: string,
): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  })
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Never'
  const diff = Date.now() - date.getTime()
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

/**
 * Linear cycles frequently have no name, in which case Linear's own UI falls
 * back to the cycle number (e.g. "Cycle 2"). Mirror that here.
 */
export function formatCycle(
  name: string | null | undefined,
  number: number | null | undefined,
): string {
  if (name && name.trim().length > 0) return name
  if (number !== null && number !== undefined) {
    const label = Number.isInteger(number) ? String(number) : number.toFixed(1)
    return `Cycle ${label}`
  }
  return '—'
}

export function formatDate(value: string | null | undefined, timeZone?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone })
}

/** Format a 0..1 ratio (bandwidth can exceed 1) as a percentage. */
export function formatPercent(
  value: number | null | undefined,
  digits = 0,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

/** Format a points value, trimming redundant decimals. */
export function formatPoints(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
