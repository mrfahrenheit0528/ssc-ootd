import './selectTestEnvironment.js'
import React from 'react'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render, screen } from '@testing-library/react'
import { ScheduleIndicator, ScheduleLegend } from './ScheduleIndicator.jsx'
import { emptyWeek, resolveDay, resolveDayWithDraft } from '../utils/attendance.js'

afterEach(cleanup)
const schedule = { ...emptyWeek(), 2: { type: 'scheduled', required_uids: ['A'] } }
const context = { selectedSemesterId: 'term',
  semesters: [{ id: 'term', status: 'active', start_date: '2026-11-01' }],
  scheduleVersions: [{ id: 'v1', semester_id: 'term', revision: 1, schedule }],
}

test('No Classes and Optional override the pin while keeping saved assignments available', () => {
  for (const type of ['no_classes', 'optional']) {
    const ctx = { ...context, calendarDays: [{ semester_id: 'term', date: '2026-11-10', type }] }
    const day = resolveDay('2026-11-10', ctx)
    const { rerender, unmount } = render(<ScheduleIndicator type={day.schedule_type} dayType={day.type} />)
    assert.equal(screen.getByRole('img', { name: 'Unscheduled' }).textContent, '➖')
    assert.equal(screen.getByRole('img').title, 'Unscheduled')
    assert.equal(screen.queryByRole('img', { name: 'Scheduled' }), null)
    assert.deepEqual(day.scheduled_uids, ['A'])
    assert.deepEqual(day.required_uids, [])
    ctx.calendarDays[0].type = 'regular'
    const regular = resolveDay('2026-11-10', ctx)
    rerender(<ScheduleIndicator type={regular.schedule_type} dayType={regular.type} />)
    assert.equal(screen.getByRole('img', { name: 'Scheduled' }).textContent, '📌')
    assert.deepEqual(regular.required_uids, ['A'])
    unmount()
  }
})

test('unsaved weekly previews still respect voluntary calendar exceptions', () => {
  const ctx = { ...context, calendarDays: [{ semester_id: 'term', date: '2026-11-10', type: 'optional' }] }
  const draft = { ...schedule, 2: { type: 'scheduled', required_uids: ['B'] } }
  const day = resolveDayWithDraft('2026-11-10', ctx, draft, '2026-11-10')
  render(<ScheduleIndicator type={day.schedule_type} dayType={day.type} />)
  assert.ok(screen.getByRole('img', { name: 'Unscheduled' }))
  assert.deepEqual(day.scheduled_uids, ['B'])
})

test('regular unscheduled days and the shared legend keep their existing markers', () => {
  const { unmount } = render(<ScheduleIndicator type="unscheduled" dayType="regular" />)
  assert.equal(screen.getByRole('img', { name: 'Unscheduled' }).textContent, '➖')
  unmount()
  render(<ScheduleLegend />)
  assert.equal(screen.getByRole('img', { name: 'Scheduled' }).textContent, '📌')
  assert.equal(screen.getByRole('img', { name: 'Unscheduled' }).textContent, '➖')
})
