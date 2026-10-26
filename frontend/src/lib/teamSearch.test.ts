import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseTeamSearch, teamIdFromSearch } from './teamSearch.ts'

describe('parseTeamSearch', () => {
  it('accepts a positive integer team id', () => {
    assert.deepEqual(parseTeamSearch({ team: 4 }), { team: 4 })
    assert.deepEqual(parseTeamSearch({ team: '12' }), { team: 12 })
  })

  it('drops missing or invalid team ids', () => {
    assert.deepEqual(parseTeamSearch({}), {})
    assert.deepEqual(parseTeamSearch({ team: 'eng' }), {})
    assert.deepEqual(parseTeamSearch({ team: 0 }), {})
    assert.deepEqual(parseTeamSearch({ team: -3 }), {})
    assert.deepEqual(parseTeamSearch({ team: 1.5 }), {})
    assert.equal(teamIdFromSearch({ team: 'nope' }), null)
    assert.equal(teamIdFromSearch({ team: 8 }), 8)
  })
})
