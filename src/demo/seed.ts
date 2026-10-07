// Sample tasks for the web demo, placed relative to today so a visitor always
// sees a believable day: something overdue, a few timed tasks with reminders,
// repeating chores, a task with steps, and a couple of Inbox items.

import { addDays, type LocalDate } from '../core/time'
import type { DataApi } from '../storage/api'

export const DEMO_SEEDED_KEY = 'miss-minutes:demo-seeded:v1'

export async function seedDemo(api: DataApi, today: LocalDate): Promise<void> {
  const work = await api.projects.create('Work')
  const home = await api.projects.create('Home')
  await api.projects.create('Errands')

  await api.tasks.create({ title: 'Submit expense report', projectId: work.id, priority: 1, due: { date: addDays(today, -2), time: null }, tags: ['admin'] })
  await api.tasks.create({
    title: 'Prepare slides for project review',
    projectId: work.id,
    priority: 2,
    due: { date: today, time: '15:00' },
    estimateMinutes: 90,
    reminders: [{ when: { kind: 'beforeDue', minutes: 60 } }],
  })
  await api.tasks.create({ title: 'Call the insurance company', priority: 3, due: { date: today, time: '11:30' }, reminders: [{ when: { kind: 'beforeDue', minutes: 15 } }], tags: ['phone'] })
  await api.tasks.create({
    title: 'Take out the recycling',
    projectId: home.id,
    due: { date: today, time: null },
    recurrence: { kind: 'rule', rrule: 'FREQ=WEEKLY' },
    tags: ['chores'],
  })
  await api.tasks.create({
    title: 'Water the plants',
    projectId: home.id,
    due: { date: addDays(today, 1), time: null },
    recurrence: { kind: 'afterCompletion', every: 4, unit: 'day' },
    tags: ['chores'],
  })
  const trip = await api.tasks.create({ title: 'Plan the cottage weekend', projectId: home.id, due: { date: addDays(today, 5), time: null }, priority: 2 })
  await api.tasks.create({ title: 'Book the ferry', parentId: trip.id })
  await api.tasks.create({ title: 'Make a grocery list', parentId: trip.id })
  await api.tasks.create({ title: 'Check the forecast', parentId: trip.id })
  await api.tasks.create({ title: 'Read that article on habit tracking' })
  await api.tasks.create({ title: 'Look into a standing desk', notes: 'Budget around $400. Check the return policy.' })
}
