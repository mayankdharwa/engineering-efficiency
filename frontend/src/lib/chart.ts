import type { CSSProperties } from 'react'

/** Height for a row-per-item chart, with a floor so short lists still render. */
export function chartHeight(
  count: number,
  { perRow, padding, min = 160 }: { perRow: number; padding: number; min?: number },
): number {
  return Math.max(min, count * perRow + padding)
}

/** Trim an axis label to `max` characters, appending an ellipsis when clipped. */
export function truncateLabel(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** Keeps long chart tooltips from spilling past the card. */
export const TOOLTIP_MAX_WIDTH_STYLE = {
  ['--ts-chart-tooltip-max-width' as string]: '20rem',
} as CSSProperties
