import { describe, expect, it } from 'vitest'
import { parseBaseline } from './baseline'
import type { CaptureContext } from './types'

const ctx: CaptureContext = { nowLocal: '2026-10-06T10:00', zone: 'America/Toronto', projectNames: ['Work', 'Home'], tagNames: [] } // a Tuesday

describe('parseBaseline', () => {
  it('pulls out a weekday and time, leaving a clean title', () => {
    expect(parseBaseline('Call the dentist Thursday at 3pm', ctx)).toMatchObject({ title: 'Call the dentist', due: { date: '2026-10-08', time: '15:00' } })
  })

  it('treats a date without a time as all-day', () => {
    expect(parseBaseline('Pay rent tomorrow', ctx)).toMatchObject({ title: 'Pay rent', due: { date: '2026-10-07', time: null } })
  })

  it('distinguishes this Friday from next Friday', () => {
    expect(parseBaseline('Submit report this Friday', ctx).due?.date).toBe('2026-10-09')
    expect(parseBaseline('Submit report next Friday', ctx).due?.date).toBe('2026-10-16')
  })

  it('reads priority, tags and a known project, and ignores an unknown project', () => {
    expect(parseBaseline('Fix the sink p1 #diy @home', ctx)).toMatchObject({ title: 'Fix the sink', priority: 1, tags: ['diy'], projectName: 'Home' })
    expect(parseBaseline('Email @nobody', ctx)).toMatchObject({ projectName: null, title: 'Email @nobody' })
  })

  it('turns "remind me to" into a reminder at the due time', () => {
    expect(parseBaseline('remind me to call mum tomorrow at 6pm', ctx)).toMatchObject({ title: 'call mum', due: { date: '2026-10-07', time: '18:00' }, reminderMinutesBefore: 0 })
    expect(parseBaseline('dentist Thursday 2pm remind me 30 minutes before', ctx).reminderMinutesBefore).toBe(30)
  })

  it('reads repeats and starts them on the first matching day', () => {
    expect(parseBaseline('Bins every Monday', ctx)).toMatchObject({ title: 'Bins', recurrence: 'FREQ=WEEKLY;BYDAY=MO', due: { date: '2026-10-12', time: null } })
    // Typed at 10:00: today's 9:30 has passed, so the first occurrence is tomorrow.
    expect(parseBaseline('Standup every weekday at 9:30', ctx)).toMatchObject({ recurrence: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', due: { date: '2026-10-07', time: '09:30' } })
    expect(parseBaseline('Take vitamins daily', ctx)).toMatchObject({ title: 'Take vitamins', recurrence: 'FREQ=DAILY' })
    expect(parseBaseline('Payroll every other Friday', ctx).recurrence).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=FR')
  })

  it('reads times in the user’s zone, whatever the machine’s zone is', () => {
    const london = { ...ctx, zone: 'Europe/London', nowLocal: '2026-10-06T23:30' }
    expect(parseBaseline('Call tomorrow at 9am', london).due).toEqual({ date: '2026-10-07', time: '09:00' })
  })

  it('never asks a clarifying question (that is what the eval measures it on)', () => {
    expect(parseBaseline('Meeting Tuesday', ctx).kind).toBe('task') // today is Tuesday: ambiguous, but it guesses
  })

  it('keeps the original text as the title if nothing else is left', () => {
    expect(parseBaseline('tomorrow', ctx).title).toBe('tomorrow')
  })
})
