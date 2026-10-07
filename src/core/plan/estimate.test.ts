import { describe, expect, it } from 'vitest'
import { parseEstimate } from './estimate'

describe('parseEstimate', () => {
  it.each([
    ['Write report 1h', 60, 'Write report'],
    ['Groceries (30m)', 30, 'Groceries'],
    ['Call Mum for 20 minutes', 20, 'Call Mum'],
    ['Deep work 1h30', 90, 'Deep work'],
    ['Deep work 1 hr 15 min', 75, 'Deep work'],
    ['Taxes 1.5 hours', 90, 'Taxes'],
    ['Stretch 10 mins p2', 10, 'Stretch p2'],
  ])('%s → %i min', (line, minutes, rest) => {
    expect(parseEstimate(line)).toEqual({ minutes, rest })
  })

  it('leaves lines without a duration alone, and ignores silly ones', () => {
    expect(parseEstimate('Pay bills')).toEqual({ minutes: null, rest: 'Pay bills' })
    expect(parseEstimate('Plan trip 30h')).toEqual({ minutes: null, rest: 'Plan trip 30h' })
    expect(parseEstimate('Meet at 3pm')).toEqual({ minutes: null, rest: 'Meet at 3pm' })
  })
})
