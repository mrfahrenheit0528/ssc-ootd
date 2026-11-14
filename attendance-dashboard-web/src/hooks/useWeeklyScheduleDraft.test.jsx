import '../components/selectTestEnvironment.js'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useWeeklyScheduleDraft } from './useWeeklyScheduleDraft.js'
import { emptyWeek } from '../utils/attendance.js'

afterEach(cleanup)
const saved = () => ({ ...emptyWeek(), 1: { type: 'scheduled', required_uids: ['ANA', 'BEN'] } })
function setup(options) {
  const view = renderHook(props => useWeeklyScheduleDraft(props), { initialProps: options ?? {} })
  act(() => view.result.current.resetSchedule(saved()))
  return view
}

test('saved schedules load locked and ignore accidental changes until explicitly unlocked', () => {
  const view = setup()
  assert.equal(view.result.current.editing, false)
  assert.equal(view.result.current.dirty, false)
  act(() => view.result.current.updateDay(1, { required_uids: ['ANA'] }))
  assert.deepEqual(view.result.current.schedule[1].required_uids, ['ANA', 'BEN'])
  act(() => view.result.current.beginEditing())
  act(() => view.result.current.updateDay(1, { required_uids: ['ANA'] }))
  assert.equal(view.result.current.editing, true)
  assert.equal(view.result.current.dirty, true)
})

test('unchecking and rechecking an officer clears Unsaved regardless of selection order', () => {
  const view = setup()
  act(() => view.result.current.beginEditing())
  act(() => view.result.current.updateDay(1, { required_uids: ['BEN'] }))
  assert.equal(view.result.current.dirty, true)
  act(() => view.result.current.updateDay(1, { required_uids: ['BEN', 'ANA'] }))
  assert.equal(view.result.current.dirty, false)
  assert.equal(view.result.current.editing, true)
  act(() => view.result.current.updateDay(0, { type: 'scheduled', required_uids: ['ANA'] }))
  assert.equal(view.result.current.dirty, true)
  act(() => view.result.current.updateDay(0, { type: 'unscheduled', required_uids: [] }))
  assert.equal(view.result.current.dirty, false)
})

test('cancel restores the saved assignments and day types, then relocks editing', () => {
  const view = setup()
  act(() => view.result.current.beginEditing())
  act(() => view.result.current.updateDay(1, { type: 'unscheduled', required_uids: [] }))
  act(() => view.result.current.cancelEditing())
  assert.deepEqual(view.result.current.schedule, saved())
  assert.equal(view.result.current.dirty, false)
  assert.equal(view.result.current.editing, false)
})

test('accepting a successful save or loading another semester establishes a new locked baseline', () => {
  const view = setup()
  act(() => view.result.current.beginEditing())
  act(() => view.result.current.updateDay(1, { required_uids: ['ANA'] }))
  const accepted = view.result.current.schedule
  act(() => view.result.current.resetSchedule(accepted))
  assert.equal(view.result.current.editing, false)
  assert.equal(view.result.current.dirty, false)
  act(() => view.result.current.beginEditing())
  act(() => view.result.current.updateDay(1, { required_uids: ['BEN'] }))
  act(() => view.result.current.cancelEditing())
  assert.deepEqual(view.result.current.schedule[1].required_uids, ['ANA'])
  act(() => view.result.current.resetSchedule(emptyWeek()))
  assert.deepEqual(view.result.current.schedule, emptyWeek())
  assert.equal(view.result.current.editing, false)
})

test('saving freezes changes and cancel without destroying the draft, allowing retry after failure', () => {
  const view = setup({ saving: false })
  act(() => view.result.current.beginEditing())
  act(() => view.result.current.updateDay(1, { required_uids: ['ANA'] }))
  view.rerender({ saving: true })
  act(() => view.result.current.cancelEditing())
  act(() => view.result.current.updateDay(1, { required_uids: [] }))
  assert.deepEqual(view.result.current.schedule[1].required_uids, ['ANA'])
  assert.equal(view.result.current.editing, true)
  assert.equal(view.result.current.dirty, true)
  view.rerender({ saving: false })
  assert.equal(view.result.current.editing, true)
  act(() => view.result.current.cancelEditing())
  assert.equal(view.result.current.editing, false)
})

test('archived semesters cannot unlock or change a schedule', () => {
  const view = setup({ readOnly: true })
  act(() => view.result.current.beginEditing())
  act(() => view.result.current.updateDay(1, { required_uids: [] }))
  assert.equal(view.result.current.editing, false)
  assert.deepEqual(view.result.current.schedule, saved())
  assert.equal(view.result.current.dirty, false)
})

test('whole-semester application can save an unchanged schedule and cancel restores the safe scope', () => {
  const view = setup()
  act(() => view.result.current.setScope('whole_semester'))
  assert.equal(view.result.current.scope, 'today_onward')
  act(() => view.result.current.beginEditing())
  act(() => view.result.current.setScope('whole_semester'))
  assert.equal(view.result.current.dirty, true)
  assert.deepEqual(view.result.current.schedule, saved())
  act(() => view.result.current.setScope('today_onward'))
  assert.equal(view.result.current.dirty, false)
  act(() => view.result.current.beginEditing('whole_semester'))
  assert.equal(view.result.current.scope, 'whole_semester')
  assert.equal(view.result.current.dirty, true)
  act(() => view.result.current.cancelEditing())
  assert.equal(view.result.current.scope, 'today_onward')
  assert.equal(view.result.current.dirty, false)
})
