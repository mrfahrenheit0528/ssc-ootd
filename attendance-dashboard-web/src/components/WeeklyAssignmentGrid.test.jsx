import './selectTestEnvironment.js'
import React, { useState } from 'react'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WeeklyAssignmentGrid from './WeeklyAssignmentGrid.jsx'
import DirectoryOfficerPicker from './DirectoryOfficerPicker.jsx'
import { emptyWeek } from '../utils/attendance.js'

afterEach(cleanup)
const officers = [
  { card_uid: 'BEN', first_name: 'Ben', last_name: 'Example', position: 'Asst. Auditor', nfc_uid: null },
  { card_uid: 'ANA', first_name: 'Ana', last_name: 'Example', position: 'Secretary' },
  { card_uid: 'OLD', first_name: 'Former', last_name: 'Example', position: 'Treasurer', active: false },
]
const initial = () => ({ ...emptyWeek(), 1: { type: 'scheduled', required_uids: ['BEN', 'OLD'] }, 0: { type: 'scheduled', required_uids: [] } })
function Grid({ disabled, changed = [] }) {
  const [schedule, setSchedule] = useState(initial)
  return <WeeklyAssignmentGrid officers={officers} schedule={schedule} disabled={disabled} onChange={(day, patch) => {
    changed.push([day, patch]); setSchedule(old => ({ ...old, [day]: { ...old[day], ...patch } }))
  }} />
}

test('the weekly table uses directory order and Monday-first columns without changing Sunday storage', async () => {
  const user = userEvent.setup(), changed = []
  render(<Grid changed={changed} />)
  assert.deepEqual(screen.getAllByRole('combobox').map(control => control.getAttribute('aria-label')), ['Monday schedule', 'Tuesday schedule', 'Wednesday schedule', 'Thursday schedule', 'Friday schedule', 'Saturday schedule', 'Sunday schedule'])
  assert.deepEqual(screen.getAllByRole('rowheader').filter(row => row.getAttribute('scope') === 'row').map(row => row.textContent.split('Example')[0].trim()), ['Ana', 'Former', 'Ben'])
  await user.click(screen.getByRole('checkbox', { name: 'Assign Ana Example on Sunday' }))
  assert.deepEqual(changed.at(-1), [0, { required_uids: ['ANA'] }])
  assert.equal(screen.getByRole('checkbox', { name: 'Assign Ben Example on Monday' }).checked, true)
})

test('filtered bulk selection affects only shown officers and retains hidden assignments', async () => {
  const user = userEvent.setup(), changed = []
  render(<Grid changed={changed} />)
  const search = screen.getByRole('searchbox')
  await user.type(search, 'Ana')
  await user.click(screen.getByRole('button', { name: 'Select shown officers on Monday' }))
  assert.deepEqual(changed.at(-1), [1, { required_uids: ['BEN', 'OLD', 'ANA'] }])
  await user.click(screen.getByRole('button', { name: 'Clear shown officers on Monday' }))
  assert.deepEqual(changed.at(-1), [1, { required_uids: ['BEN', 'OLD'] }])
  await user.clear(search)
  assert.equal(screen.getByRole('checkbox', { name: 'Assign Ben Example on Monday' }).checked, true)
  assert.equal(screen.getByRole('checkbox', { name: 'Assign Former Example on Sunday' }).disabled, true)
})

test('switching one column to unscheduled clears only that day and disables its assignments', async () => {
  const user = userEvent.setup(), changed = []
  render(<Grid changed={changed} />)
  await user.click(screen.getByRole('combobox', { name: 'Monday schedule' }))
  await user.click(await screen.findByRole('option', { name: 'Unscheduled' }))
  assert.deepEqual(changed.at(-1), [1, { type: 'unscheduled', required_uids: [] }])
  assert.equal(screen.getByRole('checkbox', { name: 'Assign Ana Example on Monday' }).disabled, true)
  assert.equal(screen.getByRole('checkbox', { name: 'Assign Ana Example on Sunday' }).disabled, false)
})

test('read-only or saving state prevents individual, bulk and day-type changes', () => {
  render(<Grid disabled />)
  assert.ok(screen.getAllByRole('checkbox').every(field => field.disabled))
  assert.ok(screen.getAllByRole('combobox').every(field => field.disabled))
  assert.ok(screen.getAllByRole('button', { name: /shown officers/ }).every(field => field.disabled))
})

test('date overrides share directory order and searching retains offscreen selections', async () => {
  const user = userEvent.setup(), changes = []
  function Picker() {
    const [value, setValue] = useState(['BEN'])
    return <DirectoryOfficerPicker officers={officers} value={value} onChange={next => { changes.push(next); setValue(next) }} />
  }
  render(<Picker />)
  const choices = screen.getAllByRole('checkbox')
  assert.match(choices[0].closest('label').textContent, /Ana Example/)
  await user.type(screen.getByRole('searchbox', { name: 'Find an officer' }), 'Secretary')
  await user.click(screen.getByRole('checkbox', { name: /Ana Example/ }))
  assert.deepEqual(changes.at(-1), ['BEN', 'ANA'])
  assert.ok(screen.getByText('2 selected'))
})
