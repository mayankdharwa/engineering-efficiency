import type { AnalyticsCycleOut, AnalyticsGroupOut, AnalyticsMemberOut } from '../types'
import { CHART_SERIES_COLORS } from './chart.ts'
import { formatCalendarDate, formatCycle } from './format.ts'

function groupSeriesKey(groupId: number | null): string {
  return groupId === null ? 'unassigned' : String(groupId)
}

export const ANALYTICS_METRICS = [
  {
    key: 'velocity',
    title: 'Velocity',
    description: 'Done points divided by the points expected so far. The dashed line is 100%.',
  },
  {
    key: 'bandwidth_efficiency',
    title: 'Bandwidth efficiency',
    description: 'Points taken divided by capacity. The dashed line is 100%.',
  },
  {
    key: 'planning_efficiency',
    title: 'Planning efficiency',
    description: 'Planned points divided by points taken. The dashed line is 100%.',
  },
] as const

export type AnalyticsMetricKey = (typeof ANALYTICS_METRICS)[number]['key']

export interface AnalyticsSeries {
  key: string
  label: string
  color: string
  /** One value per cycle label. Null is a gap so the line does not connect across it. */
  values: (number | null)[]
}

export interface AnalyticsChartModel {
  cycles: string[]
  series: AnalyticsSeries[]
}

interface RatioRow {
  planning_efficiency: number | null
  velocity: number | null
  bandwidth_efficiency: number | null
}

interface DraftSeries {
  key: string
  label: string
  color: string | null
  values: (number | null)[]
}

/** Neutral gray so the team total reads as the baseline behind the group lines. */
export const TEAM_COLOR = 'var(--muted-foreground)'

function readMetric(row: RatioRow | undefined, metric: AnalyticsMetricKey): number | null {
  return row?.[metric] ?? null
}

function blank(count: number): (number | null)[] {
  return Array.from({ length: count }, () => null)
}

/** Axis labels. Duplicate names gain the start date, then the cycle id. */
export function analyticsCycleLabels(cycles: AnalyticsCycleOut[]): string[] {
  const base = cycles.map((cycle) => formatCycle(cycle.cycle_name, cycle.cycle_number))
  const withDates = disambiguate(base, (label, index) => {
    const start = cycles[index]?.starts_at
    const suffix = start ? formatCalendarDate(start) : String(cycles[index]?.cycle_id ?? index)
    return `${label} (${suffix})`
  })
  return disambiguate(withDates, (label, index) => `${label} #${cycles[index]?.cycle_id ?? index}`)
}

function disambiguate(labels: string[], next: (label: string, index: number) => string): string[] {
  const counts = new Map<string, number>()
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  return labels.map((label, index) => ((counts.get(label) ?? 0) > 1 ? next(label, index) : label))
}

function uniqueLabels(entries: { key: string; label: string }[]): Map<string, string> {
  const keysByLabel = new Map<string, string[]>()
  for (const entry of entries) {
    const keys = keysByLabel.get(entry.label) ?? []
    keys.push(entry.key)
    keysByLabel.set(entry.label, keys)
  }
  for (const keys of keysByLabel.values()) keys.sort()

  const labels = new Map<string, string>()
  for (const entry of entries) {
    const keys = keysByLabel.get(entry.label) ?? [entry.key]
    labels.set(
      entry.key,
      keys.length < 2 ? entry.label : `${entry.label} (${keys.indexOf(entry.key) + 1})`,
    )
  }
  return labels
}

function finish(cycles: AnalyticsCycleOut[], drafts: DraftSeries[]): AnalyticsChartModel {
  const kept = drafts.filter((draft) => draft.values.some((value) => value !== null))
  const labels = uniqueLabels(kept)
  let palette = 0
  return {
    cycles: analyticsCycleLabels(cycles),
    series: kept.map((draft) => {
      const ownColor = draft.color
      const color =
        ownColor !== null && ownColor.length > 0
          ? ownColor
          : CHART_SERIES_COLORS[palette++ % CHART_SERIES_COLORS.length]
      return {
        key: draft.key,
        label: labels.get(draft.key) ?? draft.label,
        color,
        values: draft.values,
      }
    }),
  }
}

export function teamAnalyticsChart(
  cycles: AnalyticsCycleOut[],
  metric: AnalyticsMetricKey,
): AnalyticsChartModel {
  return finish(cycles, [
    {
      key: 'team',
      label: 'Team',
      color: TEAM_COLOR,
      values: cycles.map((cycle) => readMetric(cycle, metric)),
    },
  ])
}

export function groupAnalyticsChart(
  cycles: AnalyticsCycleOut[],
  metric: AnalyticsMetricKey,
): AnalyticsChartModel {
  const drafts = new Map<string, DraftSeries>()
  const order: DraftSeries[] = []
  cycles.forEach((cycle, index) => {
    for (const group of cycle.groups) {
      const draft = ensureDraft(drafts, groupDraft(group, cycles.length), order)
      if (!draft.color && group.color) draft.color = group.color
      draft.values[index] = readMetric(group, metric)
    }
  })
  return finish(cycles, order)
}

export function memberAnalyticsChart(
  cycles: AnalyticsCycleOut[],
  metric: AnalyticsMetricKey,
): AnalyticsChartModel {
  const drafts = new Map<string, DraftSeries>()
  cycles.forEach((cycle, index) => {
    for (const member of cycle.members) {
      if (!member.linear_id) continue
      const draft = ensureDraft(drafts, memberDraft(member, cycles.length))
      draft.values[index] = readMetric(member, metric)
    }
  })
  const ordered = [...drafts.values()].sort((a, b) => {
    const byName = a.label.localeCompare(b.label)
    return byName === 0 ? a.key.localeCompare(b.key) : byName
  })
  return finish(cycles, ordered)
}

export const NO_DATA_LEVEL = 'No data'

/**
 * Nine steps from dark red to dark green. The span from the metric's floor to
 * 100% is split into equal bands. Anything under the floor stays on the first
 * band, and 100% or more stays on the last.
 */
const HEAT_COLORS = [
  '#b2182b',
  '#cf5b59',
  '#e58b7f',
  '#f2c6b8',
  '#f5ebdd',
  '#dce5d3',
  '#a9c69f',
  '#6fa77a',
  '#32845b',
] as const

/** Velocity keeps a 50% floor. The other ratios use the full 0–100% span. */
const HEAT_CLIP_LOW: Record<AnalyticsMetricKey, number> = {
  velocity: 0.5,
  bandwidth_efficiency: 0,
  planning_efficiency: 0,
}

interface HeatBin {
  label: string
  below: number
  color: string
}

interface HeatScale {
  bins: HeatBin[]
  domain: string[]
  range: string[]
}

function heatScale(clipLow: number): HeatScale {
  const bins = HEAT_COLORS.map((color, index) => {
    const step = (1 - clipLow) / HEAT_COLORS.length
    const upper = clipLow + (index + 1) * step
    const lower = clipLow + index * step
    const last = index === HEAT_COLORS.length - 1
    return {
      label: last
        ? `${formatHeatPercent(lower)} and over`
        : index === 0
          ? `Under ${formatHeatPercent(upper)}`
          : `${formatHeatPercent(lower)}–${formatHeatPercent(upper)}`,
      below: last ? Number.POSITIVE_INFINITY : upper,
      color,
    }
  })
  return {
    bins,
    domain: [...bins.map((bin) => bin.label), NO_DATA_LEVEL],
    range: [...bins.map((bin) => bin.color), 'var(--muted)'],
  }
}

const HEAT_SCALES: Record<AnalyticsMetricKey, HeatScale> = {
  velocity: heatScale(HEAT_CLIP_LOW.velocity),
  bandwidth_efficiency: heatScale(HEAT_CLIP_LOW.bandwidth_efficiency),
  planning_efficiency: heatScale(HEAT_CLIP_LOW.planning_efficiency),
}

/** Legend text only. Bin edges stay exact; the printed percent snaps to the nearest 5. */
function formatHeatPercent(ratio: number): string {
  const percent = Math.round((ratio * 100) / 5) * 5
  return `${percent}%`
}

/** Hex paint for a bin label, used to pick readable cell text. */
export function heatLevelHex(level: string, metric: AnalyticsMetricKey): string | null {
  return HEAT_SCALES[metric].bins.find((bin) => bin.label === level)?.color ?? null
}

export function heatLevelFor(value: number | null, metric: AnalyticsMetricKey): string {
  if (value === null || Number.isNaN(value)) return NO_DATA_LEVEL
  const bins = HEAT_SCALES[metric].bins
  return (bins.find((bin) => value < bin.below) ?? bins[bins.length - 1]).label
}

export interface MemberHeatmapCell {
  member: string
  cycle: string
  value: number | null
  level: string
}

export interface MemberHeatmapModel {
  cycles: string[]
  members: string[]
  cells: MemberHeatmapCell[]
  /** Legend order and paint for this metric's color scale, including no data. */
  domain: string[]
  range: string[]
}

/** Every member by every cycle, in the same order as the member line data. */
export function memberHeatmap(
  cycles: AnalyticsCycleOut[],
  metric: AnalyticsMetricKey,
): MemberHeatmapModel {
  const model = memberAnalyticsChart(cycles, metric)
  const scale = HEAT_SCALES[metric]
  const cells = model.series.flatMap((series) =>
    model.cycles.map((cycle, index) => {
      const value = series.values[index] ?? null
      return { member: series.label, cycle, value, level: heatLevelFor(value, metric) }
    }),
  )
  return {
    cycles: model.cycles,
    members: model.series.map((series) => series.label),
    cells,
    domain: scale.domain,
    range: scale.range,
  }
}

export interface CycleBarPlacement {
  cycle: string
  series: string
  value: number
  /** Larger values sit higher. Bars in one cycle are one step apart. */
  y: number
}

export interface CycleBarLayout {
  bars: CycleBarPlacement[]
  /** One label per cycle, centered on that cycle's bars. */
  ticks: { y: number; label: string }[]
  domain: [number, number]
}

const BAR_STEP = 1
/** Extra space after a cycle, on top of one bar step, so groups stay separate. */
const CYCLE_GAP = 1
const EDGE_PAD = 0.65

/**
 * Horizontal bar slots, newest cycle first. A series with no value is skipped,
 * so the remaining bars in that cycle sit against each other. `occupy` keeps a
 * center tick for a cycle that has no bars, such as a team line with no groups.
 */
export function placeCycleBars(
  cyclesNewestFirst: readonly string[],
  seriesOrder: readonly string[],
  rows: readonly { cycle: string; series: string; value: number }[],
  occupy: readonly string[] = [],
): CycleBarLayout {
  const byCycle = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const series = byCycle.get(row.cycle) ?? new Map<string, number>()
    series.set(row.series, row.value)
    byCycle.set(row.cycle, series)
  }
  const occupied = new Set(occupy)

  const bars: CycleBarPlacement[] = []
  const ticks: { y: number; label: string }[] = []
  let cursor = 0
  for (const cycle of cyclesNewestFirst) {
    const values = byCycle.get(cycle)
    const present = seriesOrder.filter((series) => values?.has(series))
    if (present.length === 0) {
      if (!occupied.has(cycle)) continue
      ticks.push({ y: cursor === 0 ? 0 : -cursor, label: cycle })
      cursor += BAR_STEP + CYCLE_GAP
      continue
    }
    const start = cursor
    present.forEach((series, index) => {
      bars.push({
        cycle,
        series,
        value: values?.get(series) ?? 0,
        y: -(start + index * BAR_STEP),
      })
    })
    const end = start + (present.length - 1) * BAR_STEP
    ticks.push({ y: -((start + end) / 2), label: cycle })
    cursor = end + BAR_STEP + CYCLE_GAP
  }

  const ys = [...bars.map((bar) => bar.y), ...ticks.map((tick) => tick.y)]
  if (ys.length === 0) return { bars, ticks, domain: [0, 1] }
  return {
    bars,
    ticks,
    domain: [Math.min(...ys) - EDGE_PAD, Math.max(...ys) + EDGE_PAD],
  }
}

function groupDraft(group: AnalyticsGroupOut, count: number): DraftSeries {
  return {
    key: groupSeriesKey(group.group_id),
    label: group.label,
    color: group.color,
    values: blank(count),
  }
}

function memberDraft(member: AnalyticsMemberOut, count: number): DraftSeries {
  return {
    key: member.linear_id ?? member.name,
    label: member.name,
    color: null,
    values: blank(count),
  }
}

function ensureDraft(
  drafts: Map<string, DraftSeries>,
  incoming: DraftSeries,
  order?: DraftSeries[],
): DraftSeries {
  const existing = drafts.get(incoming.key)
  if (existing) return existing
  drafts.set(incoming.key, incoming)
  order?.push(incoming)
  return incoming
}
