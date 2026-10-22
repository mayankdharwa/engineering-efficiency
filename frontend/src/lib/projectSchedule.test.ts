import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { addWorkingDays, workingDaysForPoints, workingDaysThrough } from './projectSchedule.ts'

describe('workingDaysThrough', () => {
  it('counts weekdays from the start date through the due date', () => {
    // Monday 19 Oct 2026 through Friday 23 Oct 2026.
    assert.equal(workingDaysThrough('2026-10-19', '2026-10-23'), 5)
    assert.equal(workingDaysThrough('2026-10-19', '2026-10-19'), 1)
    assert.equal(workingDaysThrough('2026-10-17', '2026-10-18'), 0)
  })

  it('skips a weekend that falls inside the window', () => {
    // Friday 23 Oct 2026 through Monday 26 Oct 2026.
    assert.equal(workingDaysThrough('2026-10-23', '2026-10-26'), 2)
  })

  it('matches the effort that lands on the due date', () => {
    const starts = ['2026-10-19', '2026-10-17', '2026-10-18', '2026-10-23']
    for (const start of starts) {
      for (const days of [1, 2, 5, 6, 10]) {
        const due = addWorkingDays(start, days)
        assert.equal(workingDaysThrough(start, due ?? ''), days)
      }
    }
  })

  it('is negative when the due date is earlier', () => {
    assert.equal(workingDaysThrough('2026-10-23', '2026-10-19'), -5)
    assert.equal(workingDaysThrough('2026-10-19', '2026-10-17'), -1)
  })

  it('returns null for a date that is not a calendar day', () => {
    assert.equal(workingDaysThrough('not-a-date', '2026-10-19'), null)
  })
})

describe('workingDaysForPoints', () => {
  it('treats two points as one working day', () => {
    assert.equal(workingDaysForPoints(10), 5)
    assert.equal(workingDaysForPoints(5), 2.5)
    assert.equal(workingDaysForPoints(0), 0)
  })
})
