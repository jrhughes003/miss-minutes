import { describe, expect, it } from 'vitest'
import { checkStep, checkSteps, tidySteps } from './checks'

describe('checkStep', () => {
  it('accepts a short instruction', () => {
    expect(checkStep('Book a moving van')).toEqual({ ok: true, problems: [] })
  })

  it('rejects steps that don’t start like an instruction', () => {
    for (const s of ['The van booking', 'Booking the van', 'You should book a van', 'Step 1 book a van', '3 quotes from movers']) {
      expect(checkStep(s).ok, s).toBe(false)
    }
  })

  it('rejects long steps and leftover bullets', () => {
    expect(checkStep(`Write ${'a very long description '.repeat(5)}`).problems).toContain('longer than 80 characters')
    expect(checkStep('- Book a van').ok).toBe(false)
  })

  it('rejects invented dates, but allows dates the task already mentioned', () => {
    expect(checkStep('Call the movers on Friday').problems.join()).toMatch(/date or time/)
    expect(checkStep('Call the movers on Friday', 'Move house on Friday').ok).toBe(true)
  })
})

describe('checkSteps', () => {
  it('wants 3 to 7 distinct steps', () => {
    expect(checkSteps(['Book a van', 'Pack books']).problems[0]).toMatch(/2 steps/)
    expect(checkSteps(['Book a van', 'Pack books', 'book a van!']).problems.join()).toMatch(/duplicate/)
    expect(checkSteps(['Book a van', 'Pack books', 'Label boxes']).ok).toBe(true)
  })
})

describe('tidySteps', () => {
  it('strips numbering and full stops, and capitalizes', () => {
    expect(tidySteps(['1. book a van.', '- Pack books', '  ', '2) label boxes'])).toEqual(['Book a van', 'Pack books', 'Label boxes'])
  })
})
