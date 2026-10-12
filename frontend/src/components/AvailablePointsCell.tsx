import { formatPoints } from '../lib/format'

/** Leftover capacity as points and days, e.g. "3 (~1.5d)". Zero and below are "—". */
export function AvailablePointsCell({ available }: { available: number }) {
  if (available <= 0) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <span className="tabular-nums">
      <span className="font-bold">{formatPoints(available)}</span>{' '}
      <span className="text-muted-foreground">(~{formatPoints(available / 2)}d)</span>
    </span>
  )
}
