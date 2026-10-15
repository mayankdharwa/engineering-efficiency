import { formatPercent } from '../lib/format'

/**
 * Velocity cell: orange above 100%, red below 90%, otherwise neutral.
 */
export function PercentCell({ value }: { value: number | null }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>
  }
  const tone =
    value > 1
      ? 'text-orange-600 dark:text-orange-400'
      : value < 0.9
        ? 'text-destructive'
        : 'text-foreground'
  return <span className={`tabular-nums font-medium ${tone}`}>{formatPercent(value)}</span>
}
