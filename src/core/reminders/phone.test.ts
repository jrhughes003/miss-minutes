import { describe, expect, it } from 'vitest'
import type { Task } from '../tasks/types'
import { desiredPhoneEvents, PHONE_WINDOW_DAYS } from './phone'

const now = new Date('2026-10-07T14:00:00Z') // 10:00 Toronto
const rule = (o: Partial<Task['reminders'][number]> = {}) => ({ id: 'r1', when: { kind: 'beforeDue' as const, minutes: 15 }, phone: true, scheduledAt: '2026-10-01T00:00:00.000Z', ...o })
const task = (o: Partial<Task> = {}): Task => ({
  id: 't1', title: 'Dentist', notes: '', projectId: null, tags: [], priority: 4, due: { date: '2026-10-08', time: '15:00' }, estimateMinutes: null,
  recurrence: null, reminders: [rule()], parentId: null, status: 'open', completedAt: null, createdAt: '', updatedAt: '', order: 1, ...o,
})

describe('desiredPhoneEvents', () => {
  it('mirrors the next occurrence of each 📱 reminder', () => {
    expect(desiredPhoneEvents([task()], now, 'America/Toronto')).toEqual([
      { ruleId: 'r1', occurrence: '2026-10-08T14:45', taskId: 't1', title: 'Dentist', start: new Date('2026-10-08T18:45:00Z') },
    ])
  })

  it('ignores reminders not marked 📱, done tasks, past occurrences and far-future ones', () => {
    expect(desiredPhoneEvents([task({ reminders: [rule({ phone: false })] })], now, 'America/Toronto')).toEqual([])
    expect(desiredPhoneEvents([task({ status: 'done' })], now, 'America/Toronto')).toEqual([])
    expect(desiredPhoneEvents([task({ due: { date: '2026-10-06', time: '09:00' } })], now, 'America/Toronto')).toEqual([])
    const far = new Date(now.getTime() + (PHONE_WINDOW_DAYS + 2) * 86_400_000).toISOString().slice(0, 10)
    expect(desiredPhoneEvents([task({ due: { date: far, time: '09:00' } })], now, 'America/Toronto')).toEqual([])
  })
})
