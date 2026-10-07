import { describe, expect, it } from 'vitest'
import { reminderLogContract } from '../test/reminderLogContract'
import { memoryStorage } from './localRepo'
import { LocalReminderLog, REMINDER_LOG_KEY } from './localReminderLog'

reminderLogContract('localStorage', () => new LocalReminderLog(memoryStorage()))

describe('LocalReminderLog specifics', () => {
  it('persists across reloads', () => {
    const storage = memoryStorage()
    new LocalReminderLog(storage).claim({ ruleId: 'r', occurrenceLocal: 'o', taskId: 't', firedFor: 'a', firedAt: 'b' })
    expect(new LocalReminderLog(storage).get('r', 'o')).not.toBeNull()
  })

  it('starts empty if stored data is unreadable', () => {
    expect(new LocalReminderLog(memoryStorage({ [REMINDER_LOG_KEY]: '{oops' })).all()).toEqual([])
  })
})
