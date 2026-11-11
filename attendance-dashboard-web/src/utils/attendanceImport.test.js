import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAttendanceCSV, parseImportTime, previewAttendanceImport, matchOfficer } from './attendanceImport.js'
const officers = [{ card_uid: 'AAAA1111', first_name: 'Ana María', last_name: 'Cruz', active: false }, { card_uid: 'BBBB2222', first_name: 'Ben', last_name: 'Diaz' }]
const semester = { id: 'term', start_date: '2020-01-01', end_date: '2020-12-31' }
const row = { name: 'Cruz, Ana Maria', date: '2020-09-01', time_in: '9:00 AM', time_out: '5:00 PM', included: true }
const preview = (rows, options = {}) => previewAttendanceImport(rows, { officers, semester, now: new Date('2026-11-12T12:00:00+08:00'), ...options })

test('quoted CSV supports BOM, commas, escaped quotes and multiline source notes', () => {
  const rows = parseAttendanceCSV('\uFEFFdate,name,time-in,time-out,notes\r\n2020-09-01,"Cruz, Ana María",09:00,17:00,"Page ""1""\nReviewed"\r\n')
  assert.equal(rows[0].name, 'Cruz, Ana María')
  assert.equal(rows[0].notes, 'Page "1"\nReviewed')
  assert.equal(rows[0].time_in, '09:00')
  assert.equal(rows[0].rowNumber, 2)
})
test('malformed, missing and duplicate headers and shifted rows cannot silently import', () => {
  for (const csv of ['date,name,time_in\n2020-09-01,Ana,09:00', 'date,name,time_in,time_out,name\n1,2,3,4,5', 'date,name,time_in,time_out\n2020-09-01,Ana,09:00', 'date,name,time_in,time_out\n2020-09-01,"Ana,09:00,17:00']) assert.throws(() => parseAttendanceCSV(csv))
})
test('unique names tolerate accents, initials and surname-first order without guessing partial names', () => {
  assert.equal(matchOfficer({ name: 'Cruz, Ana M. María' }, officers).card_uid, 'AAAA1111')
  assert.equal(matchOfficer({ name: 'Ana' }, officers), null)
  assert.equal(matchOfficer({ name: 'Ana Maria Cruz' }, [...officers, { ...officers[0], card_uid: 'CCCC3333' }]), null)
  assert.equal(matchOfficer({ card_uid: 'bbbb2222' }, officers).card_uid, 'BBBB2222')
  assert.equal(matchOfficer({ card_uid: 'UNKNOWN', name: 'Ben Diaz' }, officers), null)
  assert.ok(preview([{ ...row, name: 'Ben Diaz', card_uid: 'AAAA1111' }])[0].issues.some(issue => issue.includes('does not match')))
})
test('time parsing handles noon, midnight and seconds, and rejects unmarked single-hour values', () => {
  assert.equal(parseImportTime('12:00 AM'), '00:00:00')
  assert.equal(parseImportTime('12:00 PM'), '12:00:00')
  assert.equal(parseImportTime('1:05:09 pm'), '13:05:09')
  assert.equal(parseImportTime('23:59'), '23:59:00')
  for (const value of ['', '9:00', '24:00', '09:60', '9.30', '13:00 PM']) assert.equal(parseImportTime(value), null)
})
test('invalid dates, missing or reversed times, future entries, and review flags block rows', () => {
  for (const patch of [{ date: '2020-02-30' }, { date: '2019-09-01' }, { time_out: '' }, { time_out: '08:00' }, { review_status: 'needs_review' }]) assert.ok(preview([{ ...row, ...patch }])[0].issues.length)
  assert.ok(preview([{ ...row, date: '2099-01-01' }], { semester: { ...semester, end_date: null } })[0].issues.some(issue => issue.includes('future')))
  const result = preview([row])[0]
  assert.equal(result.issues.length, 0)
  assert.equal(result.payload.time_in, '09:00:00')
  assert.equal(result.payload.card_uid, 'AAAA1111')
})
test('duplicates skip exact sessions and selected visits cannot overlap each other', () => {
  const results = preview([row, { ...row }, { ...row, time_in: '10:00', time_out: '18:00' }])
  assert.equal(results[0].duplicate, false)
  assert.equal(results[1].duplicate, true)
  assert.ok(results[2].issues.some(issue => issue.includes('another selected CSV row')))
  assert.equal(preview([{ ...row, included: false }, row])[1].duplicate, false)
  assert.equal(preview([{ ...row, review_status: 'needs_review' }, row])[1].duplicate, false)
})
test('existing visits detect duplicates, partial collisions and containing open sessions', () => {
  const events = [{ card_uid: 'AAAA1111', type: 'CLOCK_IN', timestamp: '2020-09-01T09:00:00+08:00' }, { card_uid: 'AAAA1111', type: 'CLOCK_OUT', timestamp: '2020-09-01T17:00:00+08:00' }]
  assert.equal(preview([row], { existing: events })[0].duplicate, true)
  assert.ok(preview([{ ...row, time_out: '18:00' }], { existing: events })[0].issues.length)
  assert.ok(preview([{ ...row, time_in: '10:00', time_out: '11:00' }], { existing: events })[0].issues.length)
  assert.equal(preview([row], { existing: events.map(event => ({ ...event, deleted_at: '2020-09-02' })) })[0].duplicate, false)
})
