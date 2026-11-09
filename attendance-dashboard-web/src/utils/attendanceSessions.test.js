import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildAttendanceSessions, filterAttendanceSessions } from './attendanceSessions.js'

function log(id, uid, type, time) {
  return { id, card_uid: uid, officer_name: `Officer ${uid}`, type, timestamp: `2026-11-10T${time}` }
}

test('one visit becomes one row containing both original editable events', () => {
  const clockIn = log('in', 'A', 'CLOCK_IN', '09:00:00')
  const clockOut = log('out', 'A', 'CLOCK_OUT', '10:00:00')
  const sessions = buildAttendanceSessions([clockOut, clockIn])
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].clockIn, clockIn)
  assert.equal(sessions[0].clockOut, clockOut)
})

test('repeat visits and interleaved officers stay in separate sessions', () => {
  const events = [
    log('a-in1', 'A', 'CLOCK_IN', '09:00:00'),
    log('b-in', 'B', 'CLOCK_IN', '09:30:00'),
    log('a-out1', 'A', 'CLOCK_OUT', '10:00:00'),
    log('a-in2', 'A', 'CLOCK_IN', '11:00:00'),
    log('b-out', 'B', 'CLOCK_OUT', '11:30:00'),
    log('a-out2', 'A', 'CLOCK_OUT', '12:00:00'),
  ]
  const sessions = buildAttendanceSessions(events.toReversed())
  assert.deepEqual(sessions.map(s => [s.clockIn.id, s.clockOut.id]), [
    ['a-in2', 'a-out2'], ['b-in', 'b-out'], ['a-in1', 'a-out1'],
  ])
  assert.equal(events[0].id, 'a-in1')
})

test('events on different dates cannot be paired and missing events remain visible', () => {
  const clockIn = log('in', 'A', 'CLOCK_IN', '09:00:00')
  const nextDayOut = { ...log('out', 'A', 'CLOCK_OUT', '10:00:00'), timestamp: '2026-11-11T10:00:00' }
  const sessions = buildAttendanceSessions([nextDayOut, clockIn])
  assert.equal(sessions.length, 2)
  assert.equal(sessions[0].clockIn, null)
  assert.equal(sessions[1].clockOut, null)
})

test('action searches keep the matching session pair intact for display and exports', () => {
  const sessions = buildAttendanceSessions([
    log('in', 'A', 'CLOCK_IN', '09:00:00'), log('out', 'A', 'CLOCK_OUT', '10:00:00'),
    log('open', 'B', 'CLOCK_IN', '11:00:00'),
  ])
  const filtered = filterAttendanceSessions(sessions, 'clock out')
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].clockIn.id, 'in')
  assert.equal(filtered[0].clockOut.id, 'out')
  assert.equal(filterAttendanceSessions(sessions, 'officer b')[0].card_uid, 'B')
})

test('an extra clock-in never hides an earlier unmatched event', () => {
  const sessions = buildAttendanceSessions([
    log('in1', 'A', 'CLOCK_IN', '09:00:00'), log('in2', 'A', 'CLOCK_IN', '09:30:00'),
    log('out', 'A', 'CLOCK_OUT', '10:00:00'),
  ])
  assert.equal(sessions.length, 2)
  assert.equal(sessions[0].clockIn.id, 'in2')
  assert.equal(sessions[1].clockIn.id, 'in1')
  assert.equal(sessions[1].clockOut, null)
})
