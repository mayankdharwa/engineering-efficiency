import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { velocityTrendWeekdayDates } from './velocityTrendChart.ts'

const TZ = 'UTC'

describe('velocityTrendWeekdayDates', () => {
  it('extends elapsed points through today plus five calendar days', () => {
    const now = new Date('2026-10-07T12:00:00Z')
    const dates = velocityTrendWeekdayDates(
      '2026-10-05T00:00:00Z',
      '2026-10-20T00:00:00Z',
      TZ,
      ['2026-10-05', '2026-10-06', '2026-10-07'],
      now,
    )
    assert.deepEqual(dates, [
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-12',
    ])
  })

  it('caps the axis at the cycle end date', () => {
    const now = new Date('2026-10-07T12:00:00Z')
    const dates = velocityTrendWeekdayDates(
      '2026-10-05T00:00:00Z',
      '2026-10-09T00:00:00Z',
      TZ,
      ['2026-10-05', '2026-10-06', '2026-10-07'],
      now,
    )
    assert.deepEqual(dates, [
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ])
  })

  it('extends from point dates when cycle bounds are missing', () => {
    const now = new Date('2026-10-07T12:00:00Z')
    const dates = velocityTrendWeekdayDates(
      null,
      null,
      TZ,
      ['2026-10-05', '2026-10-06'],
      now,
    )
    assert.deepEqual(dates, [
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-12',
    ])
  })
})
