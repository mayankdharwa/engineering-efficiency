import { formatPercent } from '../lib/format'

/**
 * A ratio cell that colours the value by how it compares to the 100% target:
 * green at/above target, red when well below, otherwise neutral.
 */
export function PercentCell({ value }: { value: number | null }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>
  }
  const tone =
    value >= 0.9
      ? 'text-emerald-600 dark:text-emerald-400'
      : value < 0.5
        ? 'text-destructive'
        : 'text-foreground'
  return <span className={`tabular-nums font-medium ${tone}`}>{formatPercent(value)}</span>
}
