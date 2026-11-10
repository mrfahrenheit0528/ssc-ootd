import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAttendanceAnalytics, bucketAttendanceTrend } from './attendanceAnalytics.js'
import { emptyWeek } from './attendance.js'

const officers = [
  { card_uid: 'A', first_name: 'Ana', last_name: 'Cruz', position: 'President', active: true },
  { card_uid: 'B', first_name: 'Ben', last_name: 'Diaz', active: true },
]
const context = {
  selectedSemesterId: 'term', officers, officerMap: Object.fromEntries(officers.map(o => [o.card_uid, o])),
  semesters: [{ id: 'term', start_date: '2026-11-01', status: 'active' }], calendarDays: [],
  scheduleVersions: [{ id: 'v1', semester_id: 'term', revision: 1, schedule: {
    ...emptyWeek(), 1: { type: 'scheduled', required_uids: ['A'] }, 2: { type: 'scheduled', required_uids: ['A'] },
  } }],
}
const event = (uid, type, time, extra = {}) => ({ id: uid + type + time, card_uid: uid, type,
  timestamp: `2026-11-09T${time}+08:00`, ...extra })
const analyze = options => buildAttendanceAnalytics({ context, dateFrom: '2026-11-09', dateTo: '2026-11-09',
  now: new Date('2026-11-11T10:00:00+08:00'), ...options })

test('repeat visits count once toward assigned attendance and sum completed time', () => {
  const result = analyze({ logs: [event('A', 'CLOCK_IN', '09:00:00'), event('A', 'CLOCK_OUT', '10:00:00'),
    event('A', 'CLOCK_IN', '13:00:00'), event('A', 'CLOCK_OUT', '14:30:00')] })
  assert.deepEqual(result.summary, { rate: 100, required: 1, present: 1, absent: 0, pending: 0,
    uniqueAttendees: 1, visits: 2, seconds: 9000, voluntaryDays: 0, incomplete: 0, openVisits: 0, orphanOuts: 0, autoClosed: 0 })
  assert.equal(result.officers.find(o => o.uid === 'A').assignedDays, 1)
})

test('volunteers cannot fill another officer duty slot, and repeat voluntary visits count one day', () => {
  const result = analyze({ logs: [event('B', 'CLOCK_IN', '09:00:00'), event('B', 'CLOCK_OUT', '10:00:00'), event('B', 'CLOCK_IN', '11:00:00')] })
  assert.equal(result.summary.rate, 0)
  assert.equal(result.summary.absent, 1)
  assert.equal(result.summary.voluntaryDays, 1)
  assert.equal(result.officers.find(o => o.uid === 'B').rate, null)
})

test('No Classes and Optional exclude assignments and absences while retaining visits', () => {
  for (const type of ['no_classes', 'optional']) {
    const result = analyze({ context: { ...context, calendarDays: [{ semester_id: 'term', date: '2026-11-09', type }] },
      logs: [event('A', 'CLOCK_IN', '09:00:00')] })
    assert.equal(result.summary.required, 0)
    assert.equal(result.summary.absent, 0)
    assert.equal(result.summary.rate, null)
    assert.equal(result.summary.voluntaryDays, 1)
  }
})

test('current and future pending slots do not dilute finalized rates or create absences', () => {
  const result = analyze({ dateTo: '2026-11-10', now: new Date('2026-11-09T15:00:00+08:00'), logs: [event('A', 'CLOCK_IN', '09:00:00')] })
  assert.equal(result.summary.rate, null)
  assert.equal(result.summary.required, 0)
  assert.equal(result.summary.pending, 1)
  assert.equal(result.summary.absent, 0)
  assert.equal(result.summary.openVisits, 1)
  assert.equal(result.summary.seconds, 0)
})

test('orphan clock-outs do not prove attendance or add duration; incomplete visits remain visible', () => {
  const result = analyze({ logs: [event('A', 'CLOCK_OUT', '08:00:00'), event('B', 'CLOCK_IN', '09:00:00')] })
  assert.equal(result.summary.absent, 1)
  assert.equal(result.summary.orphanOuts, 1)
  assert.equal(result.summary.incomplete, 1)
  assert.equal(result.summary.seconds, 0)
  assert.equal(result.summary.uniqueAttendees, 1)
})

test('archived rosters supply historical names; inactive attendees remain included', () => {
  const result = analyze({ context: { ...context, semesters: [{ ...context.semesters[0], status: 'ended',
    officer_snapshot: [{ card_uid: 'A', first_name: 'Historical', last_name: 'Name', position: 'Secretary' }] }],
  }, logs: [event('C', 'CLOCK_IN', '09:00:00', { officer_name: 'Former Officer' })] })
  assert.equal(result.officers.find(o => o.uid === 'A').name, 'Historical Name')
  assert.equal(result.officers.find(o => o.uid === 'A').position, 'Secretary')
  assert.equal(result.officers.find(o => o.uid === 'C').name, 'Former Officer')
  assert.equal(result.officers.some(o => o.uid === 'B'), false)
})

test('future and deleted taps cannot count, and auto-closed durations are disclosed', () => {
  const result = analyze({ logs: [event('A', 'CLOCK_IN', '09:00:00'), event('A', 'CLOCK_OUT', '21:00:00', { is_auto_closed: true }),
    event('B', 'CLOCK_IN', '09:00:00', { deleted_at: '2026-11-10' }),
    { ...event('B', 'CLOCK_IN', '10:00:00'), timestamp: '2026-11-12T10:00:00+08:00' }] })
  assert.equal(result.summary.uniqueAttendees, 1)
  assert.equal(result.summary.autoClosed, 1)
  assert.equal(result.summary.seconds, 43200)
})

test('empty unscheduled periods have no invented rate and trend buckets preserve every total', () => {
  const result = analyze({ context: { ...context, scheduleVersions: [] }, dateTo: '2026-11-16' })
  assert.equal(result.summary.rate, null)
  assert.equal(result.summary.visits, 0)
  assert.equal(result.daily.length, 8)
  const days = Array.from({ length: 65 }, (_, index) => ({ date: String(index), present: 2, absent: 1, pending: 3, volunteers: 4 }))
  const buckets = bucketAttendanceTrend(days)
  assert.ok(buckets.length <= 24)
  for (const key of ['present', 'absent', 'pending', 'volunteers']) {
    assert.equal(buckets.reduce((n, d) => n + d[key], 0), days.reduce((n, d) => n + d[key], 0))
  }
  assert.equal(buckets.at(-1).to, '64')
  assert.deepEqual(bucketAttendanceTrend([]), [])
})

test('weekday rates and officer totals use pinned historical assignments and exclude open days', () => {
  const ctx = { ...context, scheduleVersions: [...context.scheduleVersions, {
    id: 'v2', semester_id: 'term', revision: 2, schedule: { ...emptyWeek(), 1: { type: 'scheduled', required_uids: ['B'] }, 2: { type: 'scheduled', required_uids: ['B'] } },
  }], calendarDays: [{ semester_id: 'term', date: '2026-11-09', schedule_version_id: 'v1', type: 'regular' }] }
  const result = analyze({ context: ctx, dateTo: '2026-11-10', now: new Date('2026-11-10T15:00:00+08:00'),
    logs: [event('A', 'CLOCK_IN', '09:00:00'), event('A', 'CLOCK_OUT', '10:00:00')] })
  assert.equal(result.officers.find(o => o.uid === 'A').finalizedAssigned, 1)
  assert.equal(result.officers.find(o => o.uid === 'B').pendingDays, 1)
  assert.equal(result.summary.rate, 100)
  assert.deepEqual(result.weekdays.find(day => day.label === 'Mon'), { label: 'Mon', present: 1, required: 1, rate: 100 })
  assert.deepEqual(result.weekdays.find(day => day.label === 'Tue'), { label: 'Tue', present: 0, required: 0, rate: null })
})
