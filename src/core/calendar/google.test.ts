import { describe, expect, it } from 'vitest'
import { fromGoogleEvent, readableCalendar } from './google'

describe('fromGoogleEvent', () => {
  it('maps a timed event to UTC instants, whatever offset Google sent', () => {
    expect(
      fromGoogleEvent({ id: 'e1', summary: 'Standup', start: { dateTime: '2026-10-07T09:30:00-04:00' }, end: { dateTime: '2026-10-07T09:45:00-04:00' } }, 'work@x.com', '#123456'),
    ).toEqual({ id: 'work@x.com|e1', calendarId: 'work@x.com', title: 'Standup', allDay: false, start: '2026-10-07T13:30:00.000Z', end: '2026-10-07T13:45:00.000Z', color: '#123456' })
  })

  it('keeps all-day dates, with the exclusive end date unchanged', () => {
    expect(fromGoogleEvent({ id: 'e2', summary: 'Cottage', start: { date: '2026-10-16' }, end: { date: '2026-10-19' } }, 'fam')).toMatchObject({
      allDay: true,
      start: '2026-10-16',
      end: '2026-10-19',
    })
  })

  it('drops cancelled instances (exceptions to a recurring event)', () => {
    expect(fromGoogleEvent({ id: 'e3_20261007', status: 'cancelled', recurringEventId: 'e3' }, 'work')).toBeNull()
  })

  it('names untitled events and rejects malformed ones', () => {
    expect(fromGoogleEvent({ id: 'x', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } }, 'c')?.title).toBe('(No title)')
    expect(fromGoogleEvent({ id: 'x', start: { date: '2026-10-07' }, end: { date: '2026-10-07' } }, 'c')).toBeNull() // empty all-day
    expect(fromGoogleEvent({ id: 'x', start: { dateTime: 'soon' }, end: { dateTime: '2026-10-07T10:00:00Z' } }, 'c')).toBeNull()
    expect(fromGoogleEvent({ id: 'x', summary: 'No times' }, 'c')).toBeNull()
  })

  it('makes ids unique per calendar, since one event can appear on several', () => {
    const e = { id: 'shared', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } }
    expect(fromGoogleEvent(e, 'a')?.id).not.toBe(fromGoogleEvent(e, 'b')?.id)
  })
})

describe('readableCalendar', () => {
  it('excludes free/busy-only calendars', () => {
    expect(readableCalendar({ id: 'a', summary: 'A', accessRole: 'reader' })).toBe(true)
    expect(readableCalendar({ id: 'b', summary: 'B', accessRole: 'freeBusyReader' })).toBe(false)
  })
})
