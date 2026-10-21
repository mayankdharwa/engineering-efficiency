import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildPersonLoad,
  type CountedPerson,
  type PersonLoadIssue,
  type PersonLoadProjectInput,
} from './personLoad.ts'

function counted(...names: string[]): CountedPerson[] {
  return names.map((name) => ({ name }))
}

function issue(
  assigneeName: string | null,
  stateType: string | null,
  estimate: number | null,
): PersonLoadIssue {
  return { assigneeName, stateType, estimate }
}

function project(
  id: number,
  name: string,
  issues: PersonLoadIssue[],
  extras: Partial<PersonLoadProjectInput> = {},
): PersonLoadProjectInput {
  return {
    id,
    name,
    excluded: false,
    state: 'started',
    startDate: null,
    targetDate: null,
    issues,
    ...extras,
  }
}

describe('buildPersonLoad', () => {
  it('stacks started projects above the next one and sizes bars by remaining points', () => {
    const groups = buildPersonLoad(
      [
        project(1, 'Billing', [
          issue('Ada', 'completed', 8),
          issue('Ada', 'started', 5),
          issue('Ada', 'unstarted', 7),
          issue('Ada', 'canceled', 20),
        ]),
        project(2, 'Notifications', [issue('Ada', 'unstarted', 4)], {
          targetDate: '2026-12-01',
        }),
        project(3, 'Search', [issue('Ada', 'backlog', 9)], {
          targetDate: '2026-11-01',
        }),
        project(4, 'Later', [issue('Ada', 'unstarted', 3)], {
          targetDate: '2027-01-01',
        }),
      ],
      counted('Ada'),
    )

    assert.equal(groups.length, 1)
    const ada = groups[0]
    assert.ok(ada)
    assert.equal(ada.nowRemaining, 12)
    assert.deepEqual(
      ada.bars.map((bar) => [bar.role, bar.project, bar.done, bar.total, bar.remaining, bar.moreQueued]),
      [
        ['now', 'Billing', 8, 20, 12, 0],
        ['next', 'Search', 0, 9, 9, 2],
      ],
    )
  })

  it('orders people by remaining started work and keeps a zero-point started project', () => {
    const groups = buildPersonLoad(
      [
        project(1, 'Billing', [issue('Grace', 'started', 2), issue('Ada', 'started', null)]),
        project(2, 'Next for Ada', [issue('Ada', 'unstarted', 6)], { targetDate: '2026-10-01' }),
        project(3, 'Quiet', [issue('Bea', 'unstarted', 1)], { targetDate: '2026-10-01' }),
      ],
      counted('Ada', 'Grace', 'Bea', 'Ida'),
    )

    assert.deepEqual(
      groups.map((group) => [group.person, group.nowRemaining, group.bars.map((bar) => bar.role)]),
      [
        ['Grace', 2, ['now']],
        ['Ada', 0, ['now', 'next']],
        ['Bea', 0, ['next']],
        ['Ida', 0, ['available']],
      ],
    )
    const adaNow = groups[1]?.bars[0]
    assert.equal(adaNow?.unestimated, 1)
    assert.equal(adaNow?.remaining, 0)
  })

  it('picks the next project by due date, then start date, then name', () => {
    const groups = buildPersonLoad(
      [
        project(1, 'Undated', [issue('Ada', 'unstarted', 1)]),
        project(2, 'Zed', [issue('Ada', 'unstarted', 1)], {
          targetDate: '2026-05-01',
          startDate: '2026-02-01',
        }),
        project(3, 'Alpha', [issue('Ada', 'unstarted', 1)], {
          targetDate: '2026-05-01',
          startDate: '2026-01-01',
        }),
        project(4, 'Sooner', [issue('Ada', 'unstarted', 1)], {
          targetDate: '2026-04-01T00:00:00Z',
        }),
      ],
      counted('Ada'),
    )

    assert.equal(groups[0]?.bars[0]?.project, 'Sooner')
    assert.equal(groups[0]?.bars[0]?.moreQueued, 3)
  })

  it('matches counted people by name and drops excluded, canceled, or completed work', () => {
    const groups = buildPersonLoad(
      [
        project(1, 'Hidden', [issue('ada', 'started', 5)], { excluded: true }),
        project(2, 'Dropped', [issue('Ada', 'started', 5)], { state: 'Canceled' }),
        project(5, 'Shipped', [issue('Ada', 'started', 4)], { state: 'completed' }),
        project(3, 'Visible', [issue(' Ada ', 'started', 3)]),
        project(4, 'Other', [issue('Grace', 'started', 8)]),
      ],
      counted('Ada'),
    )

    assert.deepEqual(
      groups.map((group) => [group.person, group.bars.map((bar) => bar.project)]),
      [['Ada', ['Visible']]],
    )
  })

  it('orders several current projects by remaining points', () => {
    const groups = buildPersonLoad(
      [
        project(1, 'Small', [issue('Ada', 'started', 1)]),
        project(2, 'Large', [issue('Ada', 'started', 5), issue('Ada', 'completed', 2)]),
      ],
      counted('Ada'),
    )

    assert.deepEqual(
      groups[0]?.bars.map((bar) => [bar.project, bar.remaining, bar.done, bar.total]),
      [
        ['Large', 5, 2, 7],
        ['Small', 1, 0, 1],
      ],
    )
  })

  it('keeps each counted person\'s group on their row', () => {
    const groups = buildPersonLoad([], [
      { name: 'Ada', groupName: 'Platform', groupColor: '#336699' },
      { name: 'Grace' },
    ])

    assert.deepEqual(
      groups.map((group) => [group.person, group.groupName, group.groupColor]),
      [
        ['Ada', 'Platform', '#336699'],
        ['Grace', null, null],
      ],
    )
  })
})
