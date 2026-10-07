import { describe, expect, it } from 'vitest'
import { ALLOW, buildPayload } from './payload'

describe('buildPayload', () => {
  it('pins exactly which fields each feature may send', () => {
    expect(ALLOW).toEqual({
      capture: ['text', 'nowLocal', 'weekday', 'zone', 'projectNames', 'tagNames'],
      breakdown: ['title', 'notes', 'projectName', 'due'],
      plan: ['tasks', 'freeIntervals', 'window', 'preference', 'nowLocal'],
    })
  })

  it('drops everything not on the list, however it got there', () => {
    const everything = {
      text: 'call the dentist thursday',
      nowLocal: '2026-10-06T10:00',
      weekday: 'Tuesday',
      zone: 'America/Toronto',
      projectNames: ['Work'],
      tagNames: [],
      allTasks: [{ title: 'secret' }],
      calendarEvents: [{ title: 'Therapy appointment', attendees: ['x@y.z'] }],
      apiKey: 'sk-ant-...',
    }
    expect(Object.keys(buildPayload('capture', everything)).sort()).toEqual(['nowLocal', 'projectNames', 'tagNames', 'text', 'weekday', 'zone'])
  })

  it('never lets plan-my-day send calendar event details', () => {
    const out = buildPayload('plan', { tasks: [], freeIntervals: [], events: [{ title: 'Doctor', location: 'Clinic' }] })
    expect(out).not.toHaveProperty('events')
  })

  it('refuses an unknown feature instead of sending an unfiltered object', () => {
    expect(() => buildPayload('summarizeEverything' as never, { x: 1 })).toThrow(/Unknown AI feature/)
  })
})
