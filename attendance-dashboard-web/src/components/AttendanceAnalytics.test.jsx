import './selectTestEnvironment.js'
import React from 'react'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AttendanceAnalytics from './AttendanceAnalytics.jsx'
import { buildAttendanceAnalytics } from '../utils/attendanceAnalytics.js'

afterEach(cleanup)
window.matchMedia = () => ({ matches: true })
const scope = { from: '2026-11-09', to: '2026-11-10' }
const officers = [{ card_uid: 'A', first_name: 'Ana', last_name: 'Cruz', position: 'President' }, { card_uid: 'B', first_name: 'Ben', last_name: 'Diaz', position: 'Secretary' }]
function fixture() {
  return buildAttendanceAnalytics({ dateFrom: scope.from, dateTo: scope.to, now: new Date('2026-11-11T10:00:00+08:00'), context: {
    officers, officerMap: Object.fromEntries(officers.map(o => [o.card_uid, o])),
    semesters: [{ id: 'term', start_date: '2026-11-01', status: 'active' }],
    scheduleVersions: [{ semester_id: 'term', revision: 1, schedule: { 1: { type: 'scheduled', required_uids: ['A'] }, 2: { type: 'scheduled', required_uids: ['A'] } } }],
  }, logs: [{ card_uid: 'B', type: 'CLOCK_IN', timestamp: '2026-11-09T10:00:00+08:00' }, { card_uid: 'B', type: 'CLOCK_OUT', timestamp: '2026-11-09T11:00:00+08:00' }] })
}

test('officer search and sorting preserve overall metrics; expanded rows disclose visit quality', async () => {
  const user = userEvent.setup()
  render(<AttendanceAnalytics data={fixture()} scope={scope} />)
  const overall = screen.getByRole('region', { name: 'Required attendance' }).textContent
  await user.type(screen.getByRole('textbox', { name: 'Search officers' }), 'Ben')
  const table = screen.getByRole('table')
  assert.equal(within(table).queryByText('Ana Cruz'), null)
  assert.ok(within(table).getByText('Ben Diaz'))
  assert.equal(screen.getByRole('region', { name: 'Required attendance' }).textContent, overall)
  const officer = within(table).getByRole('button', { name: /Ben Diaz/ })
  await user.click(officer)
  assert.equal(officer.getAttribute('aria-expanded'), 'true')
  assert.ok(within(table).getByText('1 visits'))
  await user.clear(screen.getByRole('textbox', { name: 'Search officers' }))
  await user.click(screen.getByRole('combobox', { name: 'Sort officers' }))
  await user.click(screen.getByRole('option', { name: 'Most recorded hours' }))
  assert.match(within(table).getAllByRole('row')[1].textContent, /Ben Diaz/)
})

test('trend bars support keyboard selection and empty periods do not invent attendance', async () => {
  const user = userEvent.setup()
  render(<AttendanceAnalytics data={fixture()} scope={scope} />)
  const bars = screen.getByRole('group', { name: 'Attendance trend bars' })
  const choices = within(bars).getAllByRole('button')
  choices[0].focus()
  await user.keyboard('{Tab}')
  assert.equal(document.activeElement, choices[1])
  assert.equal(choices[1].getAttribute('aria-pressed'), 'true')
  cleanup()
  const data = buildAttendanceAnalytics({ dateFrom: scope.from, dateTo: scope.to, now: new Date('2026-11-11T10:00:00+08:00') })
  render(<AttendanceAnalytics data={data} scope={scope} />)
  assert.ok(screen.getByText('No finalized duties'))
  assert.ok(screen.getByText('No officers or assignments found for this period.'))
  assert.equal(screen.getByRole('button', { name: 'Export CSV' }).disabled, true)
})

test('analytics CSV exports the filtered officers, exact totals, and safe spreadsheet text', async t => {
  const user = userEvent.setup()
  const data = fixture()
  data.officers.find(o => o.uid === 'B').name = '=1+1'
  let blob, downloaded
  t.mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:test' })
  t.mock.method(URL, 'revokeObjectURL', () => {})
  t.mock.method(window.HTMLAnchorElement.prototype, 'click', function () { downloaded = this.download })
  render(<AttendanceAnalytics data={data} scope={scope} />)
  await user.type(screen.getByRole('textbox', { name: 'Search officers' }), '=1+1')
  await user.click(screen.getByRole('button', { name: 'Export CSV' }))
  const csv = await blob.text()
  assert.ok(csv.includes('"\'=1+1"'))
  assert.ok(csv.includes('"B","Secretary","0","0","0","0","","1","1","1.00"'))
  assert.equal(csv.includes('Ana Cruz'), false)
  assert.equal(downloaded, 'officer_analytics_2026-11-09_2026-11-10.csv')
})
