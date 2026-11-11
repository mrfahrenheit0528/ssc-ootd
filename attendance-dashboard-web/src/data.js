// Plain PostgreSQL records. Instant preserves the date interface used by reports.
import { client } from './supabase.js'

export class Instant {
  constructor(value) { this.value = new Date(value); this.source = typeof value === 'string' ? value : this.value.toISOString() }
  static fromDate(value) { return new Instant(value) }
  static now() { return new Instant(new Date()) }
  toDate() { return new Date(this.value) }
  toMillis() { return this.value.getTime() }
  toJSON() { return this.source }
}
export function createDataAccess(getClient = client) {
  const photoCache = new Map()
  function clearPhotoCache() { photoCache.clear() }
  const jsonTables = new Set(['day_config', 'system_settings'])
  const keyFor = table => table === 'officers' ? 'card_uid' : 'id'
  const wire = value => JSON.parse(JSON.stringify(value))
  function check(result) {
    if (result.error) throw result.error
    return result.data
  }
  function normalizeRecord(table, row) {
    const record = jsonTables.has(table) ? { id: row.id, ...row.data } : { ...row }
    for (const key of ['timestamp', 'created_at', 'ended_at', 'updated_at', 'opened_at', 'expires_at', 'status_at']) {
      if (typeof record[key] === 'string') record[key] = new Instant(record[key])
    }
    return record
  }
  async function attachPhotos(records, table) {
    if (!['officers', 'semesters'].includes(table)) return records
    const officers = table === 'officers' ? records : records.flatMap(s => s.officer_snapshot ?? [])
    const ids = [...new Set(officers.map(o => o.photo_id).filter(Boolean))].filter(id => !photoCache.has(id))
    // Photo bytes stay out of attendance queries and are protected by membership RLS.
    for (let start = 0; start < ids.length; start += 100) {
      const photos = check(await getClient().from('officer_photos').select('id,content,mime_type').in('id', ids.slice(start, start + 100)))
      for (const photo of photos) {
        const hex = photo.content.replace(/^\\x/, '')
        const bytes = hex.match(/.{2}/g)?.map(v => String.fromCharCode(parseInt(v, 16))).join('') ?? ''
        photoCache.set(photo.id, `data:${photo.mime_type};base64,${btoa(bytes)}`)
      }
    }
    for (const officer of officers) officer.photo_url = photoCache.get(officer.photo_id) ?? ''
    return records
  }
  async function listRecords(table, options = {}) {
    const all = []
    // Page explicitly: a semester can exceed Supabase's response row limit.
    for (let offset = 0; ; offset += 500) {
      let q = getClient().from(table).select('*')
      if (table === 'officers' && !options.includeInactive) q = q.eq('active', true)
      if (table === 'attendance_logs') q = q.is('deleted_at', null)
      for (const key of options.isNull ?? []) q = q.is(key, null)
      if (options.from) q = q.gte('timestamp', new Date(options.from).toISOString())
      if (options.to) q = q.lte('timestamp', new Date(options.to).toISOString())
      if (options.until) q = q.lt('timestamp', new Date(options.until).toISOString())
      for (const [key, value] of Object.entries(options.filters ?? {})) q = q.eq(key, value)
      if (options.orderBy) q = q.order(options.orderBy, { ascending: options.ascending ?? false })
      q = q.order(keyFor(table), { ascending: true }).range(offset, offset + 499)
      const rows = check(await q)
      all.push(...rows.map(row => normalizeRecord(table, row)))
      if (rows.length < 500) break
    }
    return attachPhotos(all, table)
  }
  async function getRecord(table, id) {
    const row = check(await getClient().from(table).select('*').eq(keyFor(table), id).maybeSingle())
    return row ? normalizeRecord(table, row) : null
  }
  async function saveRecord(table, id, value) {
    const payload = wire(value)
    const row = jsonTables.has(table) ? { id, data: payload } : { ...payload, [keyFor(table)]: id }
    if (['officers','attendance_logs'].includes(table)) throw new Error('Use the officer or audited attendance workflow.')
    check(await getClient().from(table).upsert(row))
  }
  async function updateRecord(table, id, value) {
    if (['officers','attendance_logs'].includes(table)) throw new Error('Use the officer or audited attendance workflow.')
    check(await getClient().from(table).update(wire(value)).eq(keyFor(table), id).select(keyFor(table)).single())
  }
  async function addRecord(table, value) {
    if (['officers','attendance_logs'].includes(table)) throw new Error('Use the officer or audited attendance workflow.')
    check(await getClient().from(table).insert(wire(value)))
  }
  async function deleteRecord(table, id, reason) {
    if (table === 'officers') return check(await getClient().rpc('deactivate_officer', { p_uid: id }))
    // Preserve IDs so a delayed reader retry cannot recreate a deleted log.
    if (table === 'attendance_logs') return check(await getClient().rpc('delete_attendance', { p_id: id, p_reason: reason }))
    check(await getClient().from(table).delete().eq(keyFor(table), id))
  }
  async function uploadPhoto(blob) {
    if (blob.size > 1024 * 1024) throw new Error('Please use a compressed photo under 1 MB.')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return check(await getClient().rpc('upload_officer_photo', { p_base64: btoa(binary), p_mime_type: blob.type }))
  }
  async function archiveSemester(id, endDate) {
    check(await getClient().rpc('archive_semester', { p_id: id, p_end_date: endDate }))
  }
  async function activateSemester(id) { check(await getClient().rpc('activate_semester', { p_id: id })) }
  async function saveOfficer(uid, profile, { create = false, reactivate = false } = {}) {
    return check(await getClient().rpc('save_officer', { p_uid: uid, p_profile: wire(profile), p_create: create, p_reactivate: reactivate }))
  }
  async function saveOfficerProfile(id, nfcUid, profile, { create = false, reactivate = false } = {}) {
    return check(await getClient().rpc('save_officer_profile', { p_id: id ?? null, p_nfc_uid: nfcUid || null,
      p_profile: wire(profile), p_create: create, p_reactivate: reactivate }))
  }
  async function saveAttendance(id, payload, reason) {
    return check(await getClient().rpc('correct_attendance', { p_id: id ?? null, p_uid: payload.card_uid,
      p_type: payload.type, p_timestamp: wire(payload.timestamp), p_auto: payload.is_auto_closed, p_reason: reason }))
  }
  async function importAttendanceCSV(semesterId, rows, reason) {
    return check(await getClient().rpc('import_attendance_csv', { p_semester_id: semesterId, p_rows: wire(rows), p_reason: reason }))
  }
  async function saveWeek(semesterId, schedule) {
    return check(await getClient().rpc('save_semester_schedule', { p_semester_id: semesterId, p_schedule: wire(schedule) }))
  }
  async function saveCalendarDay(semesterId, date, type, note, requiredUids) {
    return check(await getClient().rpc('save_calendar_day', { p_semester_id: semesterId, p_date: date, p_type: type, p_note: note, p_required_uids: requiredUids ?? null }))
  }
  async function setEnrollment(owner, active) {
    return check(await getClient().rpc('set_enrollment', { p_owner: owner, p_active: active }))
  }
  async function recoverAttendance() { return check(await getClient().rpc('recover_due_attendance')) }
  function watch(table, load, onData, onError = console.error) {
    let stopped = false
    let requested = 0
    const refresh = async () => {
      const current = ++requested
      try {
        const result = await load()
        if (!stopped && current === requested) onData(result)
      } catch (error) {
        if (!stopped && current === requested) onError(error)
      }
    }
    const channel = getClient().channel(`ssc-${table}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, refresh)
      .subscribe(status => {
        if (status === 'SUBSCRIBED') refresh()
        if (!stopped && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) onError(new Error('Live connection interrupted. Reconnecting…'))
      })
    refresh()
    window.addEventListener('online', refresh)
    return () => {
      stopped = true
      window.removeEventListener('online', refresh)
      getClient().removeChannel(channel)
    }
  }
  const watchRecords = (table, options, onData, onError) => watch(table, () => listRecords(table, options), onData, onError)
  const watchRecord = (table, id, onData, onError) => watch(table, () => getRecord(table, id), onData, onError)
  return { clearPhotoCache, normalizeRecord, listRecords, getRecord, saveRecord, updateRecord, addRecord, deleteRecord, uploadPhoto, archiveSemester, activateSemester, watchRecords, watchRecord, saveOfficer, saveOfficerProfile, saveAttendance, importAttendanceCSV, saveWeek, saveCalendarDay, setEnrollment, recoverAttendance }
}

export const { clearPhotoCache, normalizeRecord, listRecords, getRecord, saveRecord, updateRecord, addRecord, deleteRecord, uploadPhoto, archiveSemester, activateSemester, watchRecords, watchRecord, saveOfficer, saveOfficerProfile, saveAttendance, importAttendanceCSV, saveWeek, saveCalendarDay, setEnrollment, recoverAttendance } = createDataAccess()
