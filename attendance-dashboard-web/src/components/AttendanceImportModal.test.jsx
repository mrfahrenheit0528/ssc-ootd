import './selectTestEnvironment.js'
import React from 'react'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AttendanceImportModal from './AttendanceImportModal.jsx'

afterEach(cleanup)
const officers = [{ card_uid: 'AAAA1111', first_name: 'Ana', last_name: 'Cruz' }]
const semesters = [{ id: 'term', name: 'Historical term', status: 'ended', start_date: '2020-01-01', end_date: '2020-12-31' }]
const loadOfficers = async () => officers
const loadExisting = async () => []
const csv = 'date,name,time_in,time_out,review_status\n2020-09-01,Ana Cruz,09:00,17:00,ready'
async function upload(user, content = csv) {
  const input = screen.getByLabelText('Attendance CSV file')
  await waitFor(() => assert.equal(input.disabled, false))
  const file = new window.File([content], 'paper.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'text', { value: async () => content })
  await user.upload(input, file)
}
function setup(props = {}) {
  const calls = []
  render(<AttendanceImportModal semesters={semesters} initialSemesterId="term" loadOfficers={loadOfficers} loadExisting={loadExisting}
    importRows={async (...args) => { calls.push(args); return { imported_sessions: 1, skipped_sessions: 0, inserted_events: 2 } }} onClose={() => {}} onImported={() => {}} {...props} />)
  return calls
}

test('a reviewed CSV imports matched UIDs and paired school-time values in one batch', async () => {
  const user = userEvent.setup(), calls = setup()
  await upload(user)
  const button = screen.getByRole('button', { name: 'Import 1 sessions' })
  await waitFor(() => assert.equal(button.disabled, false))
  await user.click(button)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'term')
  assert.deepEqual(calls[0][1][0], { card_uid: 'AAAA1111', date: '2020-09-01', time_in: '09:00:00', time_out: '17:00:00', source: 'paper.csv row 2', notes: '', signature: '' })
  assert.ok(screen.getByText(/Imported 1 sessions/))
})

test('missing times and transcription review must be resolved or excluded before importing', async () => {
  const user = userEvent.setup()
  setup()
  await upload(user, 'date,name,time_in,time_out,review_status\n2020-09-01,Ana Cruz,09:00,,needs_review')
  assert.equal(screen.getByRole('button', { name: 'Import 0 sessions' }).disabled, true)
  await user.type(screen.getByLabelText('Time-out for row 2'), '17:00')
  assert.equal(screen.getByRole('button', { name: 'Import 0 sessions' }).disabled, true)
  await user.click(screen.getByRole('button', { name: 'Mark row 2 reviewed' }))
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Import 1 sessions' }).disabled, false))
})

test('existing duplicates are skipped and failed duplicate checks prevent saving', async () => {
  const user = userEvent.setup(), calls = setup({ loadExisting: async () => [
    { card_uid: 'AAAA1111', type: 'CLOCK_IN', timestamp: '2020-09-01T09:00:00+08:00' },
    { card_uid: 'AAAA1111', type: 'CLOCK_OUT', timestamp: '2020-09-01T17:00:00+08:00' },
  ] })
  await upload(user)
  await screen.findByText('1 duplicates skipped')
  assert.equal(screen.getByRole('button', { name: 'Import 0 sessions' }).disabled, true)
  assert.equal(calls.length, 0)
  cleanup()
  setup({ loadExisting: async () => { throw new Error('Connection unavailable') } })
  await upload(user)
  await screen.findByRole('alert')
  assert.equal(screen.getByRole('button', { name: 'Import 1 sessions' }).disabled, true)
})

test('server rejection keeps the review available for a safe retry', async () => {
  const user = userEvent.setup()
  setup({ importRows: async () => { throw { code: 'PGRST202', message: 'Missing function' } } })
  await upload(user)
  const button = screen.getByRole('button', { name: 'Import 1 sessions' })
  await waitFor(() => assert.equal(button.disabled, false))
  await user.click(button)
  assert.match(screen.getByRole('alert').textContent, /Run the new attendance CSV import SQL migration/)
  assert.equal(screen.getByLabelText('Time-in for row 2').value, '09:00')
})

test('an unmatched CSV name can create a profile without a card after explicit selection', async () => {
  const user = userEvent.setup(), calls = setup()
  await upload(user, 'date,firstname,lastname,position,time_in,time_out\n2020-09-01,Maria,Reyes,Secretary,09:00,17:00')
  assert.equal(screen.getByRole('button', { name: 'Import 0 sessions' }).disabled, true)
  await user.click(screen.getByRole('button', { name: 'Create missing profiles without cards' }))
  const button = screen.getByRole('button', { name: 'Import 1 sessions' })
  await waitFor(() => assert.equal(button.disabled, false))
  await user.click(button)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1][0].create_profile, true)
  assert.equal(calls[0][1][0].first_name, 'Maria')
  assert.equal(calls[0][1][0].last_name, 'Reyes')
  assert.equal(calls[0][1][0].card_uid, undefined)
})
