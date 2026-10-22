import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  projectGroupEffort,
  stackGroupEffort,
  UNASSIGNED_GROUP_KEY,
} from './projectGroupEffort.ts'

const groups = [
  { id: 1, name: 'Platform', color: '#2563eb' },
  { id: 2, name: 'Design', color: '#db2777' },
]

const members = [
  { name: 'Ada', groupId: 1 },
  { name: 'Bea', groupId: 2 },
  { name: 'Cleo', groupId: null },
]

describe('projectGroupEffort', () => {
  it('splits estimated points into point-equivalent days by group', () => {
    const slices = projectGroupEffort(
      [
        { assigneeName: 'Ada', stateType: 'started', estimate: 4 },
        { assigneeName: 'Ada', stateType: 'completed', estimate: 2 },
        { assigneeName: 'Bea', stateType: 'unstarted', estimate: 3 },
      ],
      members,
      groups,
    )
    assert.deepEqual(
      slices.map((slice) => [slice.label, slice.points, slice.days, slice.color]),
      [
        ['Design', 3, 1.5, '#db2777'],
        ['Platform', 6, 3, '#2563eb'],
      ],
    )
  })

  it('skips canceled issues and estimates that do not add days', () => {
    const slices = projectGroupEffort(
      [
        { assigneeName: 'Ada', stateType: 'canceled', estimate: 8 },
        { assigneeName: 'Ada', stateType: 'started', estimate: null },
        { assigneeName: 'Ada', stateType: 'started', estimate: 0 },
        { assigneeName: 'Bea', stateType: 'started', estimate: 2 },
      ],
      members,
      groups,
    )
    assert.deepEqual(
      slices.map((slice) => [slice.label, slice.points]),
      [['Design', 2]],
    )
  })

  it('puts unknown, ungrouped, and unassigned work in one bucket', () => {
    const slices = projectGroupEffort(
      [
        { assigneeName: null, stateType: 'started', estimate: 2 },
        { assigneeName: 'Cleo', stateType: 'started', estimate: 2 },
        { assigneeName: '  ada ', stateType: 'started', estimate: 4 },
        { assigneeName: 'Nobody', stateType: 'started', estimate: 1 },
        { assigneeName: 'Gone', stateType: 'started', estimate: 1 },
      ],
      [
        ...members,
        { name: 'Gone', groupId: 99 },
      ],
      groups,
    )
    assert.deepEqual(
      slices.map((slice) => [slice.key, slice.label, slice.points, slice.days]),
      [
        ['1', 'Platform', 4, 2],
        [UNASSIGNED_GROUP_KEY, 'Unassigned', 6, 3],
      ],
    )
  })

  it('keeps the first grouped member when names collide', () => {
    const slices = projectGroupEffort(
      [{ assigneeName: 'Ada', stateType: 'started', estimate: 2 }],
      [
        { name: 'Ada', groupId: null },
        { name: 'ada', groupId: 2 },
        { name: 'Ada', groupId: 1 },
      ],
      groups,
    )
    assert.equal(slices[0]?.label, 'Design')
  })
})

describe('stackGroupEffort', () => {
  it('lays group days end to end in legend order', () => {
    const slices = projectGroupEffort(
      [
        { assigneeName: 'Ada', stateType: 'started', estimate: 4 },
        { assigneeName: 'Bea', stateType: 'started', estimate: 2 },
        { assigneeName: null, stateType: 'started', estimate: 2 },
      ],
      members,
      groups,
    )
    const stacked = stackGroupEffort(
      slices,
      slices.map((slice) => slice.key),
    )
    assert.deepEqual(
      stacked.map((slice) => [slice.label, slice.x1, slice.x2]),
      [
        ['Design', 0, 1],
        ['Platform', 1, 3],
        ['Unassigned', 3, 4],
      ],
    )
  })
})
