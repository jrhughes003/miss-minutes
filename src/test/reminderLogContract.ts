// Contract every ReminderLog must meet. The claim rule is the heart of the
// "never notify twice" guarantee, so both stores are held to identical tests.

import { describe, expect, it } from 'vitest'
import type { ReminderLog } from '../core/reminders/engine'

const fire = (o: Partial<{ ruleId: string; occurrenceLocal: string; taskId: string; firedFor: string; firedAt: string }> = {}) => ({
  ruleId: 'r1',
  occurrenceLocal: '2026-10-08T13:15',
  taskId: 't1',
  firedFor: '2026-10-08T17:15:00.000Z',
  firedAt: '2026-10-08T17:15:10.000Z',
  ...o,
})

export function reminderLogContract(name: string, makeLog: () => ReminderLog): void {
  describe(`ReminderLog contract: ${name}`, () => {
    it('claims a new occurrence once, and refuses the same claim again', () => {
      const log = makeLog()
      expect(log.claim(fire())).toBe(true)
      expect(log.claim(fire())).toBe(false)
      expect(log.claim(fire({ firedAt: '2026-10-08T17:16:00.000Z' }))).toBe(false)
      expect(log.get('r1', '2026-10-08T13:15')).toMatchObject({ status: 'fired', firedFor: '2026-10-08T17:15:00.000Z', snoozeUntil: null })
    })

    it('treats each occurrence of a rule separately', () => {
      const log = makeLog()
      expect(log.claim(fire())).toBe(true)
      expect(log.claim(fire({ occurrenceLocal: '2026-10-15T13:15' }))).toBe(true)
      expect(log.all()).toHaveLength(2)
    })

    it('lets a snoozed reminder fire again, once, for a later instant', () => {
      const log = makeLog()
      log.claim(fire())
      log.update('r1', '2026-10-08T13:15', { status: 'snoozed', snoozeUntil: '2026-10-08T17:30:00.000Z' })
      expect(log.claim(fire({ firedFor: '2026-10-08T17:30:00.000Z' }))).toBe(true)
      expect(log.claim(fire({ firedFor: '2026-10-08T17:30:00.000Z' }))).toBe(false)
      expect(log.get('r1', '2026-10-08T13:15')).toMatchObject({ status: 'fired', snoozeUntil: null, firedFor: '2026-10-08T17:30:00.000Z' })
    })

    it('never re-fires a snoozed reminder for the same or an earlier instant', () => {
      const log = makeLog()
      log.claim(fire())
      log.update('r1', '2026-10-08T13:15', { status: 'snoozed', snoozeUntil: '2026-10-08T17:30:00.000Z' })
      expect(log.claim(fire())).toBe(false)
    })

    it('never re-fires a dismissed or done reminder', () => {
      const log = makeLog()
      log.claim(fire())
      log.update('r1', '2026-10-08T13:15', { status: 'dismissed' })
      expect(log.claim(fire({ firedFor: '2026-10-09T00:00:00.000Z' }))).toBe(false)
      log.update('r1', '2026-10-08T13:15', { status: 'done' })
      expect(log.claim(fire({ firedFor: '2026-10-09T00:00:00.000Z' }))).toBe(false)
    })

    it('rolls back claims made in a failed transaction', () => {
      const log = makeLog()
      expect(() =>
        log.transaction(() => {
          log.claim(fire())
          throw new Error('crash')
        }),
      ).toThrow('crash')
      expect(log.get('r1', '2026-10-08T13:15')).toBeNull()
      expect(log.claim(fire())).toBe(true)
    })

    it('ignores updates to entries that do not exist', () => {
      const log = makeLog()
      expect(() => log.update('nope', 'x', { status: 'done' })).not.toThrow()
      expect(log.all()).toEqual([])
    })
  })
}
