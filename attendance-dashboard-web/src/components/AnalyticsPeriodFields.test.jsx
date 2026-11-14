import './selectTestEnvironment.js'
import React from 'react'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AnalyticsPeriodFields from './AnalyticsPeriodFields.jsx'
import { useHistoryFilters } from '../hooks/useHistoryFilters.js'
import { dateBounds } from '../utils/attendanceTime.js'

afterEach(cleanup)
const semester={id:'term',start_date:'2026-08-10',end_date:'2026-12-20'}
function Filters({ requests, disabled }) {
  const filters=useHistoryFilters({semesters:[semester],activeSemester:semester,loading:false,error:'',today:'2026-11-15',allowSingleDay:true,load:()=>{}})
  return <form onSubmit={event=>{event.preventDefault();requests.push([filters.from,filters.to,filters.semesterId,dateBounds(filters.from,filters.to)])}}>
    <AnalyticsPeriodFields filters={filters} semester={semester} disabled={disabled} />
    <button type="submit">Analyze</button>
  </form>
}
test('a selected single day submits equal dates and exactly one school-day query window',async()=>{
  const user=userEvent.setup(),requests=[]
  render(<Filters requests={requests} />)
  await user.click(screen.getByRole('combobox',{name:'Analysis view'}))
  await user.click(screen.getByRole('option',{name:'Single day'}))
  assert.equal(screen.queryByLabelText('From'),null)
  assert.equal(screen.queryByLabelText('To'),null)
  const field=screen.getByLabelText('Date')
  assert.equal(field.value,'2026-11-15','a future semester end must not become the default single date')
  assert.equal(field.min,semester.start_date)
  assert.equal(field.max,semester.end_date)
  fireEvent.change(field,{target:{value:'2026-08-31'}})
  await user.click(screen.getByRole('button',{name:'Analyze'}))
  assert.deepEqual(requests,[['2026-08-31','2026-08-31','term',{from:'2026-08-31T00:00:00+08:00',until:'2026-09-01T00:00:00+08:00'}]])
  await user.click(screen.getByRole('combobox',{name:'Analysis view'}))
  await user.click(screen.getByRole('option',{name:'Date range'}))
  assert.equal(screen.getByLabelText('From').value,'2026-08-31')
  fireEvent.change(screen.getByLabelText('To'),{target:{value:'2026-09-02'}})
  await user.click(screen.getByRole('button',{name:'Analyze'}))
  assert.deepEqual(requests.at(-1).slice(0,3),['2026-08-31','2026-09-02','term'])
})
test('unavailable semester metadata disables the view and date fields',()=>{
  render(<Filters requests={[]} disabled />)
  assert.equal(screen.getByRole('combobox',{name:'Analysis view'}).disabled,true)
  assert.equal(screen.getByLabelText('From').disabled,true)
  assert.equal(screen.getByLabelText('To').disabled,true)
})
