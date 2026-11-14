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
function fixture(logs = [{ card_uid: 'B', type: 'CLOCK_IN', timestamp: '2026-11-09T10:00:00+08:00' }, { card_uid: 'B', type: 'CLOCK_OUT', timestamp: '2026-11-09T11:00:00+08:00' }]) {
  return buildAttendanceAnalytics({ dateFrom: scope.from, dateTo: scope.to, now: new Date('2026-11-11T10:00:00+08:00'), context: {
    officers, officerMap: Object.fromEntries(officers.map(o => [o.card_uid, o])),
    semesters: [{ id: 'term', start_date: '2026-11-01', status: 'active' }],
    scheduleVersions: [{ semester_id: 'term', revision: 1, schedule: { 1: { type: 'scheduled', required_uids: ['A'] }, 2: { type: 'scheduled', required_uids: ['A'] } } }],
  }, logs })
}

function breakdownFixture(allPresent = false) {
  const roster=[...officers,
    {card_uid:'C',first_name:'Cara',last_name:'Reyes',position:'Treasurer'},
    {card_uid:'D',first_name:'Dan',last_name:'Vega',position:'Auditor'},
    {card_uid:'E',first_name:'Eve',last_name:'Santos',position:'Officer'}]
  const logs=['A','B',...(allPresent ? ['C'] : [])].flatMap(card_uid=>[
    {card_uid,type:'CLOCK_IN',timestamp:'2026-11-09T09:00:00+08:00'},
    {card_uid,type:'CLOCK_OUT',timestamp:'2026-11-09T10:00:00+08:00'},
  ])
  return buildAttendanceAnalytics({dateFrom:scope.from,dateTo:scope.to,now:new Date('2026-11-10T12:00:00+08:00'),logs,context:{
    officers:roster,officerMap:Object.fromEntries(roster.map(o=>[o.card_uid,o])),
    semesters:[{id:'term',start_date:'2026-11-01',status:'active'}],
    scheduleVersions:[{semester_id:'term',revision:1,schedule:{1:{type:'scheduled',required_uids:['A','C']},2:{type:'scheduled',required_uids:['E']}}}],
  }})
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

test('a single-day report labels the daily chart and explains recorded hours',()=>{
  const data=fixture()
  data.daily=data.daily.slice(0,1)
  render(<AttendanceAnalytics data={data} scope={{from:scope.from,to:scope.from}} />)
  assert.ok(screen.getByRole('heading',{name:'Attendance on Nov 9'}))
  assert.equal(screen.getByRole('group',{name:'Attendance trend bars'}).querySelectorAll('button').length,1)
  assert.ok(screen.getByText(/Total completed visit time/))
})

test('the default attendance view includes assigned attendees and volunteers without idle, absent-only or pending-only officers',async()=>{
  const user=userEvent.setup()
  render(<AttendanceAnalytics data={breakdownFixture()} scope={scope} />)
  const table=screen.getByRole('table')
  assert.ok(within(table).getByText('Ana Cruz'))
  assert.ok(within(table).getByText('Ben Diaz'))
  for(const name of ['Cara Reyes','Dan Vega','Eve Santos']) assert.equal(within(table).queryByText(name),null)
  assert.match(within(table).getAllByRole('row')[1].textContent,/Ana Cruz/)
  const volunteer=within(table).getByRole('button',{name:/Ben Diaz/}).closest('tr')
  assert.match(volunteer.textContent,/—/,'volunteers must not receive an invented required-attendance percentage')
  await user.click(screen.getByRole('combobox',{name:'Sort officers'}))
  assert.equal(screen.queryByRole('option',{name:/Name A/}),null)
})

test('the absence view and export include only finalized missed required duties and preserve overview metrics',async t=>{
  const user=userEvent.setup()
  let blob
  t.mock.method(URL,'createObjectURL',value=>{blob=value;return 'blob:absences'})
  t.mock.method(URL,'revokeObjectURL',()=>{})
  t.mock.method(window.HTMLAnchorElement.prototype,'click',()=>{})
  render(<AttendanceAnalytics data={breakdownFixture()} scope={scope} />)
  const overview=screen.getByRole('region',{name:'Required attendance'}).textContent
  await user.click(screen.getByRole('combobox',{name:'Sort officers'}))
  await user.click(screen.getByRole('option',{name:'Most absences'}))
  const table=screen.getByRole('table')
  assert.ok(within(table).getByText('Cara Reyes'))
  for(const name of ['Ana Cruz','Ben Diaz','Dan Vega','Eve Santos']) assert.equal(within(table).queryByText(name),null)
  assert.equal(screen.getByRole('region',{name:'Required attendance'}).textContent,overview)
  await user.click(screen.getByRole('button',{name:'Export CSV'}))
  const csv=await blob.text()
  assert.ok(csv.includes('Cara Reyes'))
  for(const name of ['Ana Cruz','Ben Diaz','Dan Vega','Eve Santos']) assert.equal(csv.includes(name),false)
})

test('pending duties and volunteers alone cannot populate the absences list',async()=>{
  const user=userEvent.setup()
  render(<AttendanceAnalytics data={breakdownFixture(true)} scope={scope} />)
  await user.click(screen.getByRole('combobox',{name:'Sort officers'}))
  await user.click(screen.getByRole('option',{name:'Most absences'}))
  assert.ok(screen.getByText('No missed required duties for this period.'))
  assert.equal(screen.getByRole('button',{name:'Export CSV'}).disabled,true)
})

test('recorded-hours view and export exclude officers with zero recorded time',async t=>{
  const user=userEvent.setup()
  let blob
  t.mock.method(URL,'createObjectURL',value=>{blob=value;return 'blob:hours'})
  t.mock.method(URL,'revokeObjectURL',()=>{})
  t.mock.method(window.HTMLAnchorElement.prototype,'click',()=>{})
  render(<AttendanceAnalytics data={breakdownFixture()} scope={scope} />)
  await user.click(screen.getByRole('combobox',{name:'Sort officers'}))
  await user.click(screen.getByRole('option',{name:'Most recorded hours'}))
  const table=screen.getByRole('table')
  assert.ok(within(table).getByText('Ana Cruz'))
  assert.ok(within(table).getByText('Ben Diaz'))
  for(const name of ['Cara Reyes','Dan Vega','Eve Santos']) assert.equal(within(table).queryByText(name),null)
  await user.click(screen.getByRole('button',{name:'Export CSV'}))
  const csv=await blob.text()
  for(const name of ['Ana Cruz','Ben Diaz']) assert.ok(csv.includes(name))
  for(const name of ['Cara Reyes','Dan Vega','Eve Santos']) assert.equal(csv.includes(name),false)
})

test('a clock-in without a completed duration does not appear in recorded hours',async()=>{
  const user=userEvent.setup()
  const data=fixture([{card_uid:'B',type:'CLOCK_IN',timestamp:'2026-11-09T10:00:00+08:00'}])
  render(<AttendanceAnalytics data={data} scope={scope} />)
  await user.click(screen.getByRole('combobox',{name:'Sort officers'}))
  await user.click(screen.getByRole('option',{name:'Most recorded hours'}))
  assert.ok(screen.getByText('No recorded hours for this period.'))
  assert.equal(screen.getByRole('button',{name:'Export CSV'}).disabled,true)
})
