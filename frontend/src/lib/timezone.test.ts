import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calendarDaysUntil, weekdaysUntil } from './timezone.ts'

// Friday 20 Nov 2026.
const FRIDAY = new Date('2026-11-20T12:00:00Z')

describe('calendarDaysUntil', () => {
  it('counts calendar days rather than working days', () => {
    assert.equal(calendarDaysUntil('2026-11-23', 'UTC', FRIDAY), 3)
    assert.equal(calendarDaysUntil('2026-11-21', 'UTC', FRIDAY), 1)
    assert.equal(calendarDaysUntil('2026-11-20', 'UTC', FRIDAY), 0)
  })

  it('returns null for an overdue date', () => {
    assert.equal(calendarDaysUntil('2026-11-19', 'UTC', FRIDAY), null)
  })

  it('distinguishes tomorrow from the next working day', () => {
    // Monday is one working day away but three calendar days away.
    assert.equal(weekdaysUntil('2026-11-23', 'UTC', FRIDAY), 1)
    assert.equal(calendarDaysUntil('2026-11-23', 'UTC', FRIDAY), 3)
  })
})
