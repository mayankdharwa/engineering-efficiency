import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  groupAnalyticsChart,
  heatLevelFor,
  heatLevelHex,
  memberAnalyticsChart,
  memberHeatmap,
  NO_DATA_LEVEL,
  placeCycleBars,
  teamAnalyticsChart,
} from './analyticsSeries.ts'
import type { AnalyticsCycleOut, AnalyticsGroupOut, AnalyticsMemberOut } from '../types.ts'

function cycle(overrides: Partial<AnalyticsCycleOut> = {}): AnalyticsCycleOut {
  return {
    cycle_id: 1,
    cycle_name: null,
    cycle_number: 1,
    starts_at: '2026-01-05T12:00:00Z',
    ends_at: '2026-01-16T12:00:00Z',
    planning_efficiency: null,
    velocity: null,
    bandwidth_efficiency: null,
    groups: [],
    members: [],
    ...overrides,
  }
}

function group(overrides: Partial<AnalyticsGroupOut> = {}): AnalyticsGroupOut {
  return {
    group_id: 1,
    label: 'Platform',
    color: '#2563eb',
    members: 1,
    planning_efficiency: null,
    velocity: null,
    bandwidth_efficiency: null,
    ...overrides,
  }
}

function member(overrides: Partial<AnalyticsMemberOut> = {}): AnalyticsMemberOut {
  return {
    linear_id: 'u1',
    name: 'Ada',
    group_id: 1,
    group_name: 'Platform',
    group_color: '#2563eb',
    counts_toward_capacity: true,
    planning_efficiency: null,
    velocity: null,
    bandwidth_efficiency: null,
    ...overrides,
  }
}

describe('analytics series', () => {
  it('plots the team ratio in cycle order and keeps the primary color', () => {
    const model = teamAnalyticsChart(
      [
        cycle({ cycle_id: 1, cycle_number: 2, velocity: 0.1, bandwidth_efficiency: 0.4 }),
        cycle({ cycle_id: 2, cycle_number: 3, velocity: 0.2, bandwidth_efficiency: 0.5 }),
      ],
      'bandwidth_efficiency',
    )
    assert.deepEqual(model.cycles, ['Cycle 2', 'Cycle 3'])
    assert.equal(model.series[0]?.color, 'var(--muted-foreground)')
    assert.deepEqual(model.series[0]?.values, [0.4, 0.5])
  })

  it('keeps group creation order, group color, and a gap when a group is missing', () => {
    const model = groupAnalyticsChart(
      [
        cycle({
          groups: [group({ group_id: 2, label: 'Beta', color: '#111111', velocity: 0.2 })],
        }),
        cycle({
          groups: [
            group({ group_id: 1, label: 'Alpha', color: null, velocity: 0.3 }),
            group({ group_id: 2, label: 'Beta', color: '#111111', velocity: null }),
          ],
        }),
      ],
      'velocity',
    )
    assert.deepEqual(
      model.series.map((series) => series.label),
      ['Beta', 'Alpha'],
    )
    assert.equal(model.series[0]?.color, '#111111')
    assert.equal(model.series[1]?.color, 'var(--chart-1)')
    assert.deepEqual(model.series[0]?.values, [0.2, null])
  })

  it('drops series that never have a value and numbers duplicate member names', () => {
    const model = memberAnalyticsChart(
      [
        cycle({
          cycle_id: 1,
          members: [
            member({ linear_id: 'u2', name: 'Ada', velocity: 0.2 }),
            member({ linear_id: 'gone', name: 'Zoe', velocity: null }),
          ],
        }),
        cycle({
          cycle_id: 2,
          cycle_number: 2,
          members: [member({ linear_id: 'u1', name: 'Ada', velocity: 0.4 })],
        }),
      ],
      'velocity',
    )
    assert.deepEqual(
      model.series.map((series) => [series.key, series.label, series.values]),
      [
        ['u1', 'Ada (1)', [null, 0.4]],
        ['u2', 'Ada (2)', [0.2, null]],
      ],
    )
  })

  it('bins velocity from 60% to 110% and the other ratios from 0% to 100%', () => {
    assert.equal(heatLevelFor(null, 'velocity'), NO_DATA_LEVEL)
    const colors = [
      '#b2182b',
      '#cf5b59',
      '#e58b7f',
      '#f2c6b8',
      '#f5ebdd',
      '#dce5d3',
      '#a9c69f',
      '#6fa77a',
      '#32845b',
    ]
    const velocityStep = 0.5 / colors.length
    colors.forEach((color, index) => {
      const sample = 0.6 + (index + 0.5) * velocityStep
      assert.equal(heatLevelHex(heatLevelFor(sample, 'velocity'), 'velocity'), color)
    })
    assert.equal(heatLevelHex(heatLevelFor(0.59, 'velocity'), 'velocity'), '#b2182b')
    assert.equal(heatLevelHex(heatLevelFor(0.5, 'velocity'), 'velocity'), '#b2182b')
    assert.equal(heatLevelHex(heatLevelFor(1, 'velocity'), 'velocity'), '#6fa77a')
    assert.equal(heatLevelHex(heatLevelFor(1.1, 'velocity'), 'velocity'), '#32845b')
    assert.equal(heatLevelHex(heatLevelFor(1.3, 'velocity'), 'velocity'), '#32845b')
    assert.deepEqual(
      colors.map((_, index) => heatLevelFor(0.6 + (index + 0.5) * velocityStep, 'velocity')),
      [
        'Under 65%',
        '65%–70%',
        '70%–75%',
        '75%–80%',
        '80%–90%',
        '90%–95%',
        '95%–100%',
        '100%–105%',
        '105% and over',
      ],
    )

    const fullStep = 1 / colors.length
    for (const metric of ['bandwidth_efficiency', 'planning_efficiency'] as const) {
      colors.forEach((color, index) => {
        const sample = (index + 0.5) * fullStep
        assert.equal(heatLevelHex(heatLevelFor(sample, metric), metric), color)
      })
      assert.deepEqual(
        colors.map((_, index) => heatLevelFor((index + 0.5) * fullStep, metric)),
        [
          'Under 10%',
          '10%–20%',
          '20%–35%',
          '35%–45%',
          '45%–55%',
          '55%–65%',
          '65%–80%',
          '80%–90%',
          '90% and over',
        ],
      )
      assert.equal(heatLevelHex(heatLevelFor(0, metric), metric), '#b2182b')
      assert.equal(heatLevelHex(heatLevelFor(-0.1, metric), metric), '#b2182b')
      assert.equal(heatLevelHex(heatLevelFor(0.49, metric), metric), colors[4])
      assert.equal(heatLevelHex(heatLevelFor(1, metric), metric), '#32845b')
      assert.equal(heatLevelHex(heatLevelFor(1.4, metric), metric), '#32845b')
    }
  })

  it('builds a member by cycle heatmap with gaps as no data', () => {
    const heatmap = memberHeatmap(
      [
        cycle({
          cycle_id: 1,
          cycle_number: 2,
          members: [
            member({ linear_id: 'u1', name: 'Ada', velocity: 0.6 }),
            member({ linear_id: 'u2', name: 'Grace', velocity: 1.3 }),
          ],
        }),
        cycle({
          cycle_id: 2,
          cycle_number: 3,
          members: [member({ linear_id: 'u1', name: 'Ada', velocity: 0.9 })],
        }),
      ],
      'velocity',
    )
    assert.deepEqual(heatmap.cycles, ['Cycle 2', 'Cycle 3'])
    assert.deepEqual(heatmap.members, ['Ada', 'Grace'])
    assert.deepEqual(
      heatmap.cells.map((cell) => [cell.member, cell.cycle, cell.level]),
      [
        ['Ada', 'Cycle 2', heatLevelFor(0.6, 'velocity')],
        ['Ada', 'Cycle 3', heatLevelFor(0.9, 'velocity')],
        ['Grace', 'Cycle 2', heatLevelFor(1.3, 'velocity')],
        ['Grace', 'Cycle 3', NO_DATA_LEVEL],
      ],
    )
  })

  it('packs a cycle’s bars and does not reserve a slot for a missing group', () => {
    const layout = placeCycleBars(
      ['Cycle 5', 'Cycle 2'],
      ['Team', 'QA', 'BE', 'FE'],
      [
        { cycle: 'Cycle 5', series: 'Team', value: 0.4 },
        { cycle: 'Cycle 5', series: 'BE', value: 0.35 },
        { cycle: 'Cycle 5', series: 'FE', value: 0.7 },
        { cycle: 'Cycle 2', series: 'Team', value: 0.9 },
        { cycle: 'Cycle 2', series: 'QA', value: 0.85 },
        { cycle: 'Cycle 2', series: 'BE', value: 1 },
        { cycle: 'Cycle 2', series: 'FE', value: 0.95 },
      ],
    )
    const cycle5 = layout.bars.filter((bar) => bar.cycle === 'Cycle 5')
    const cycle2 = layout.bars.filter((bar) => bar.cycle === 'Cycle 2')
    assert.deepEqual(
      cycle5.map((bar) => bar.series),
      ['Team', 'BE', 'FE'],
    )
    assert.deepEqual(
      cycle5.slice(1).map((bar, index) => cycle5[index].y - bar.y),
      [1, 1],
    )
    assert.ok(cycle5[0] && cycle2[0] && cycle5[0].y > cycle2[0].y)
    assert.equal(cycle5.at(-1)!.y - cycle2[0].y, 2)
    assert.equal(layout.ticks[0]?.label, 'Cycle 5')
    assert.equal(layout.ticks[0]?.y, cycle5[1]?.y)
  })

  it('keeps a center tick when a cycle has no bars', () => {
    const layout = placeCycleBars(
      ['Cycle 5', 'Cycle 2'],
      ['BE', 'FE'],
      [{ cycle: 'Cycle 2', series: 'BE', value: 0.5 }],
      ['Cycle 5'],
    )
    assert.deepEqual(
      layout.bars.map((bar) => [bar.cycle, bar.series]),
      [['Cycle 2', 'BE']],
    )
    const cycle5 = layout.ticks.find((tick) => tick.label === 'Cycle 5')
    const cycle2 = layout.ticks.find((tick) => tick.label === 'Cycle 2')
    assert.equal(cycle5?.y, 0)
    assert.equal(cycle2?.y, layout.bars[0]?.y)
    assert.ok(cycle5 && cycle2 && cycle5.y > cycle2.y)
  })

  it('gives colliding cycle names distinct axis labels', () => {
    const model = teamAnalyticsChart(
      [
        cycle({
          cycle_id: 1,
          cycle_name: 'Sprint',
          velocity: 0.2,
          starts_at: '2026-01-05T12:00:00Z',
        }),
        cycle({
          cycle_id: 2,
          cycle_name: 'Sprint',
          cycle_number: 2,
          velocity: 0.4,
          starts_at: '2026-01-19T12:00:00Z',
        }),
      ],
      'velocity',
    )
    assert.notEqual(model.cycles[0], model.cycles[1])
    assert.ok(model.cycles[0]?.startsWith('Sprint'))
    assert.ok(model.cycles[1]?.startsWith('Sprint'))
  })
})
