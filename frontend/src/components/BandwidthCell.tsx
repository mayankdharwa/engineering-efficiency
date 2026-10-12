import { formatPercent, formatPoints } from '../lib/format'

const BANDWIDTH_DIGITS = 1

/** Percentage as shown in the cell, or null when there is no ratio. */
function displayedPercent(ratio: number | null | undefined): number | null {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return null
  return Number((ratio * 100).toFixed(BANDWIDTH_DIGITS))
}

/** Colour the load figure by how it compares to a full 100% allocation. */
function bandwidthTone(displayed: number | null): string {
  if (displayed === null) return 'text-muted-foreground'
  if (displayed < 100) return 'text-amber-600 dark:text-amber-400'
  if (displayed > 100) return 'text-destructive'
  return 'text-foreground'
}

interface BandwidthCellProps {
  taken: number
  capacity: number
  ratio: number | null
}

/** Combined bandwidth cell, e.g. "90.0% (18/20)". */
export function BandwidthCell({ taken, capacity, ratio }: BandwidthCellProps) {
  const displayed = displayedPercent(ratio)
  const percent = displayed === null ? '—' : formatPercent(ratio, BANDWIDTH_DIGITS)
  const weight = displayed !== null && displayed !== 100 ? 'font-bold' : 'font-normal'
  return (
    <span className="tabular-nums">
      <span className={`${weight} ${bandwidthTone(displayed)}`}>{percent}</span>{' '}
      <span className="text-muted-foreground">
        ({formatPoints(taken)}/{formatPoints(capacity)})
      </span>
    </span>
  )
}
