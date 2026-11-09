import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { createDataAccess } from './data.js'

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

test('profile updates preserve relational photo IDs and omit derived display fields', async () => {
  let sent
  const repo = repository((_url, options) => { sent = JSON.parse(options.body); return new Response(null, { status: 201 }) })
  await repo.saveRecord('officers', 'AAAA1111', { first_name: 'Ana', photo_id: 'photo-id', photo_url: 'data:image/jpeg;base64,test', status: 'ON_DUTY' })
  assert.equal(sent.photo_id, 'photo-id')
  assert.equal(sent.card_uid, 'AAAA1111')
  assert.equal(sent.active, true)
  assert.equal(sent.photo_url, undefined)
  assert.equal(sent.status, undefined)
})

test('deleting attendance writes a tombstone instead of removing its retry ID', async () => {
  const repo = repository((_url, options) => {
    assert.equal(options.method, 'PATCH')
    assert.ok(JSON.parse(options.body).deleted_at)
    return json({ id: 'event-id' })
  })
  await repo.deleteRecord('attendance_logs', 'event-id')
})

test('failed authorization propagates to the UI instead of reporting success', async () => {
  const repo = repository(() => json({ code: '42501', message: 'permission denied' }, 403))
  await assert.rejects(repo.uploadPhoto(new Blob([new Uint8Array([255,216,255])], { type: 'image/jpeg' })), error => error.code === '42501')
})
