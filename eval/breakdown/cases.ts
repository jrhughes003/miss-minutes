// The task-breakdown eval (PLAN.md §5.4): 40 vague tasks, frozen 2026-10-07
// before any breakdown prompt was run.
//
// Every case gets the programmatic shape checks (core/breakdown/checks.ts).
// The 20 marked `rate: true` also go into a sheet for the owner to score by
// hand for usefulness (1 = not useful, 2 = partly, 3 = would use as is). Code
// can't judge usefulness, and an LLM judge would just be a second model
// grading the first.

export interface BreakdownCase {
  id: string
  title: string
  notes?: string
  projectName?: string
  due?: string
  rate: boolean
}

const RAW: Omit<BreakdownCase, 'id' | 'rate'>[] = [
  { title: 'Move house', due: '2026-11-28' },
  { title: 'Plan Mum’s 60th birthday', projectName: 'Home' },
  { title: 'Do my taxes', notes: 'Self-employed this year for the first time' },
  { title: 'Get the car ready for winter' },
  { title: 'Organize the garage' },
  { title: 'Prepare for the job interview', due: '2026-10-14 10:00' },
  { title: 'Start running again' },
  { title: 'Clean up my email inbox' },
  { title: 'Write the quarterly report', projectName: 'Work', due: '2026-10-30' },
  { title: 'Find a new dentist' },
  { title: 'Learn basic Spanish before the trip', notes: 'Trip is in March' },
  { title: 'Redo the bathroom' },
  { title: 'Sort out home insurance', notes: 'Current policy renews next month' },
  { title: 'Get fit' },
  { title: 'Host a dinner party for eight' },
  { title: 'Onboard the new team member', projectName: 'Work' },
  { title: 'Back up all the family photos' },
  { title: 'Plan the cottage weekend', projectName: 'Home' },
  { title: 'Fix the leaky kitchen tap' },
  { title: 'Apply for a passport renewal' },
  { title: 'Declutter the closet' },
  { title: 'Set up a budget', notes: 'Use the finance app' },
  { title: 'Prepare the conference talk', projectName: 'Work', due: '2026-11-12' },
  { title: 'Buy a new laptop' },
  { title: 'Plan a vegetable garden for spring' },
  { title: 'Get the kids’ Halloween costumes' },
  { title: 'Migrate the team wiki', projectName: 'Work' },
  { title: 'Paint the spare room' },
  { title: 'Write a will' },
  { title: 'Train the puppy' },
  { title: 'Renew my professional licence', due: '2026-12-31' },
  { title: 'Plan the holiday gift list' },
  { title: 'Fix my sleep schedule' },
  { title: 'Clear out the freezer' },
  { title: 'Hire a contractor for the roof' },
  { title: 'Update my resume' },
  { title: 'Organize the team offsite', projectName: 'Work' },
  { title: 'Sell the old bike' },
  { title: 'Make the house more energy efficient' },
  { title: 'Plan meals for the week' },
]

export const BREAKDOWN_CASES: BreakdownCase[] = RAW.map((c, i) => ({ ...c, id: `b${String(i + 1).padStart(2, '0')}`, rate: i % 2 === 0 }))
