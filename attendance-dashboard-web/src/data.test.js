import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { createDataAccess, Instant } from './data.js'

function repository(handler) {
  const sdk = createClient('https://ssc-test.supabase.co', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, options) => handler(new URL(input), options) },
  })
  return createDataAccess(() => sdk)
}
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json' },
})

test('semester attendance reads all pages and preserves timestamp interfaces', async () => {
  let requests = 0
  const repo = repository(url => {
    assert.equal(url.pathname, '/rest/v1/attendance_logs')
    assert.equal(url.searchParams.get('deleted_at'), 'is.null')
    assert.equal(url.searchParams.get('order'), 'timestamp.desc,id.asc')
    requests++
    const offset = Number(url.searchParams.get('offset') ?? 0)
    return json(Array.from({ length: offset === 0 ? 500 : 1 }, (_, i) => ({
      id: `event-${offset + i}`, card_uid: 'AAAA1111', timestamp: '2026-11-09T09:00:00+08:00', type: 'CLOCK_IN',
    })))
  })
  const logs = await repo.listRecords('attendance_logs', { orderBy: 'timestamp', from: new Date('2026-11-09T00:00:00Z') })
  assert.equal(requests, 2)
  assert.equal(logs.length, 501)
  assert.equal(logs[500].id, 'event-500')
  assert.equal(logs[0].timestamp.toDate().toISOString(), '2026-11-09T01:00:00.000Z')
})

test('PostgreSQL photo bytes display correctly and archived references reuse them', async () => {
  let photoRequests = 0
  const repo = repository(url => {
    if (url.pathname.endsWith('/officers')) return json([{ card_uid: 'AAAA1111', photo_id: 'photo-id' }])
    if (url.pathname.endsWith('/semesters')) return json([{ id: 'term', officer_snapshot: [{ card_uid: 'AAAA1111', photo_id: 'photo-id' }] }])
    if (url.pathname.endsWith('/officer_photos')) {
      photoRequests++
      return json([{ id: 'photo-id', content: '\\xffd8ffe000', mime_type: 'image/jpeg' }])
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  const officers = await repo.listRecords('officers')
  assert.equal(officers[0].photo_url, 'data:image/jpeg;base64,/9j/4AA=')
  const semesters = await repo.listRecords('semesters')
  assert.equal(semesters[0].officer_snapshot[0].photo_url, officers[0].photo_url)
  assert.equal(photoRequests, 1)
  repo.clearPhotoCache()
  await repo.listRecords('officers')
  assert.equal(photoRequests, 2)
})

test('JSON settings retain day configuration fields and native record IDs', async () => {
  const repo = repository(() => json({ id: 'weekly', data: { effective_from: '2026-11-09', schedule: { 1: { required_uids: ['AAAA1111'] } } } }))
  const config = await repo.getRecord('day_config', 'weekly')
  assert.equal(config.id, 'weekly')
  assert.deepEqual(config.schedule[1].required_uids, ['AAAA1111'])
  assert.equal(config.effective_from, '2026-11-09')
})

test('profile create and restore are distinct server operations', async () => {
  const calls=[]
  const repo=repository((url,options)=>{calls.push([url.pathname,JSON.parse(options.body)]);return json(null)})
  await repo.saveOfficer('AAAA1111',{first_name:'Ana',photo_id:'photo-id'},{create:true})
  await repo.saveOfficer('AAAA1111',{first_name:'Ana'},{reactivate:true})
  assert.equal(calls[0][0],'/rest/v1/rpc/save_officer')
  assert.equal(calls[0][1].p_create,true)
  assert.equal(calls[1][1].p_reactivate,true)
})

test('optional cards stay separate from profile keys and pending queries use null filters', async () => {
  const repo=repository((url,options)=>{
    if (url.pathname.endsWith('/pending_card_events')) {
      assert.equal(url.searchParams.get('linked_officer_key'),'is.null')
      return json([])
    }
    assert.equal(url.pathname,'/rest/v1/rpc/save_officer_profile')
    assert.deepEqual(JSON.parse(options.body),{p_id:null,p_nfc_uid:null,p_profile:{first_name:'Maria',last_name:'Reyes',position:'Secretary'},p_create:true,p_reactivate:false})
    return json('OFF0123456789ABCDEF0123456789ABCDEF')
  })
  await repo.saveOfficerProfile(null,'',{first_name:'Maria',last_name:'Reyes',position:'Secretary'},{create:true})
  await repo.listRecords('pending_card_events',{isNull:['linked_officer_key']})
})

test('deleting attendance requires a reason through the audited RPC', async () => {
  const repo=repository((url,options)=>{
    assert.equal(url.pathname,'/rest/v1/rpc/delete_attendance')
    assert.deepEqual(JSON.parse(options.body),{p_id:'event-id',p_reason:'Duplicate tap'})
    return json(null)
  })
  await repo.deleteRecord('attendance_logs','event-id','Duplicate tap')
})

test('attendance queries use an exclusive school-day upper bound',async()=>{
  const repo=repository(url=>{
    assert.equal(url.searchParams.get('timestamp'),'lt.2026-11-10T16:00:00.000Z')
    return json([])
  })
  await repo.listRecords('attendance_logs',{until:'2026-11-11T00:00:00+08:00'})
})

test('failed authorization propagates to the UI instead of reporting success', async () => {
  const repo = repository(() => json({ code: '42501', message: 'permission denied' }, 403))
  await assert.rejects(repo.uploadPhoto(new Blob([new Uint8Array([255,216,255])], { type: 'image/jpeg' })), error => error.code === '42501')
})

test('unchanged correction timestamps preserve PostgreSQL microseconds',async()=>{
  const timestamp=new Instant('2026-11-09T09:15:42.123456+08:00')
  const repo=repository((url,options)=>{
    assert.equal(url.pathname,'/rest/v1/rpc/correct_attendance')
    const sent=JSON.parse(options.body)
    assert.equal(sent.p_timestamp,'2026-11-09T09:15:42.123456+08:00')
    assert.equal(sent.p_reason,'Fix action only')
    return json('event-id')
  })
  await repo.saveAttendance('event-id',{card_uid:'A',type:'CLOCK_OUT',timestamp,is_auto_closed:false},'Fix action only')
})

test('CSV import uses one audited server batch and preserves a failed response', async () => {
  const rows = [{ date: '2020-09-01', card_uid: 'AAAA1111', time_in: '09:00:00', time_out: '17:00:00' }]
  const repo = repository((url, options) => {
    assert.equal(url.pathname, '/rest/v1/rpc/import_attendance_csv')
    assert.deepEqual(JSON.parse(options.body), { p_semester_id: 'term', p_rows: rows, p_reason: 'Paper logbook' })
    return json({ imported_sessions: 1, skipped_sessions: 0, inserted_events: 2 })
  })
  assert.equal((await repo.importAttendanceCSV('term', rows, 'Paper logbook')).inserted_events, 2)
  const failing = repository(() => json({ code: 'P0001', message: 'Row 2: overlaps existing attendance' }, 400))
  await assert.rejects(failing.importAttendanceCSV('term', rows, 'Paper logbook'), error => error.code === 'P0001' && error.message.includes('overlaps existing'))
})
