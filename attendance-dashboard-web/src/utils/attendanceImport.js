import { dateKey, toDate } from './attendanceTime.js'
import { nfcUid } from './officerIdentity.js'

export const IMPORT_HEADERS = ['date', 'name', 'first_name', 'last_name', 'position', 'time_in', 'time_out', 'card_uid', 'signature', 'source', 'notes', 'review_status']

// Strict quoted CSV parsing: never silently shift a name or time into another column.
export function parseAttendanceCSV(text) {
  if (text.length > 1024 * 1024) throw new Error('Use a CSV file under 1 MB.')
  const records = [], record = []
  let field = '', quoted = false, endedQuote = false
  const cell = () => { record.push(field); field = ''; endedQuote = false }
  const line = () => { cell(); if (record.some(value => value.trim())) records.push([...record]); record.length = 0 }
  const source = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index++ }
      else if (char === '"') { quoted = false; endedQuote = true }
      else field += char
    } else if (char === ',') cell()
    else if (char === '\r' || char === '\n') { line(); if (char === '\r' && source[index + 1] === '\n') index++ }
    else if (char === '"' && !field && !endedQuote) quoted = true
    else if (endedQuote && /\s/.test(char)) continue
    else if (endedQuote || char === '"') throw new Error('Invalid CSV quoting. Put names containing commas inside double quotes.')
    else field += char
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.')
  if (field || record.length || endedQuote) line()
  if (records.length < 2) throw new Error('CSV needs a header and at least one attendance row.')
  if (records.length > 501) throw new Error('Import at most 500 rows per file.')
  const aliases = { officer: 'name', officer_name: 'name', full_name: 'name', uid: 'card_uid', timein: 'time_in', timeout: 'time_out' }
  const headers = records.shift().map(value => {
    const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    return aliases[key] ?? key
  })
  if (new Set(headers).size !== headers.length || headers.some(h => !h)) throw new Error('CSV headers must be unique and nonempty.')
  if (!['date', 'time_in', 'time_out'].every(h => headers.includes(h)) || !headers.some(h => ['name', 'card_uid'].includes(h))) {
    throw new Error('Required columns: date, name (or card_uid), time_in, time_out. Download the import template.')
  }
  return records.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${values.length} columns; expected ${headers.length}.`)
    return { ...Object.fromEntries(headers.map((key, i) => [key, values[i].trim()])), rowNumber: index + 2, included: true }
  })
}

export const normalizeOfficerName = name => String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(token => token.length > 1).sort().join(' ')
export const officerName = officer => `${officer.first_name} ${officer.last_name}`.trim()
export function matchOfficer(row, officers) {
  if (row.card_uid) return officers.find(o => o.card_uid === row.card_uid.trim().toUpperCase() || nfcUid(o) === row.card_uid.trim().toUpperCase()) ?? null
  const normalized = normalizeOfficerName(row.name)
  if (!normalized) return null
  const matches = officers.filter(o => normalizeOfficerName(officerName(o)) === normalized)
  return matches.length === 1 ? matches[0] : null
}
export function validImportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
export function parseImportTime(value = '') {
  const text = value.trim()
  const military = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(text)
  if (military) return `${military[1]}:${military[2]}:${military[3] ?? '00'}`
  const ampm = /^(0?[1-9]|1[0-2]):([0-5]\d)(?::([0-5]\d))?\s*(AM|PM)$/i.exec(text)
  if (!ampm) return null
  const hour = Number(ampm[1]) % 12 + (ampm[4].toUpperCase() === 'PM' ? 12 : 0)
  return `${String(hour).padStart(2, '0')}:${ampm[2]}:${ampm[3] ?? '00'}`
}

export function previewAttendanceImport(rows, { officers = [], semester, existing = [], now = new Date() } = {}) {
  const seen = new Set(), ranges = []
  return rows.map(row => {
    const issues = [], officer = matchOfficer(row, officers)
    const createsProfile = !officer && row.create_profile === true && !row.card_uid
    const entered = parseImportTime(row.time_in), exited = parseImportTime(row.time_out)
    const dateValid = validImportDate(row.date)
    if (!semester) issues.push('Choose a semester.')
    if (!dateValid) issues.push('Enter the date as YYYY-MM-DD.')
    else if (semester && (row.date < semester.start_date || (semester.end_date && row.date > semester.end_date))) issues.push('Date is outside the selected semester.')
    if (!officer && !createsProfile) issues.push('Choose an officer or enable a new profile without a card.')
    if (createsProfile && (!row.first_name?.trim() || !row.last_name?.trim() || row.first_name.length > 100 || row.last_name.length > 100 || (row.position?.length ?? 0) > 150)) issues.push('First and last names are required for a new profile (100 characters each).')
    if (createsProfile && officers.some(o => normalizeOfficerName(officerName(o)) === normalizeOfficerName(`${row.first_name} ${row.last_name}`))) issues.push('A profile with this name already exists. Select it explicitly.')
    if (officer && row.card_uid && row.name && normalizeOfficerName(row.name) !== normalizeOfficerName(officerName(officer))) issues.push('Name does not match this card UID. Confirm the officer selection.')
    if (!entered || !exited) issues.push('Both times are required. Use HH:mm (24-hour) or h:mm AM/PM.')
    if (entered && exited && exited <= entered) issues.push('Time-out must be later than time-in on the same date.')
    if (dateValid && exited && new Date(`${row.date}T${exited}+08:00`) > toDate(now)) issues.push('Attendance cannot end in the future.')
    if (row.review_status && !['ready', 'confirmed'].includes(row.review_status.toLowerCase())) issues.push('Review the transcription and mark this row reviewed.')
    if ((row.source?.length ?? 0) > 200 || (row.notes?.length ?? 0) > 1000 || (row.signature?.length ?? 0) > 50) issues.push('Source, notes, or signature text is too long.')
    let duplicate = false
    if ((officer || createsProfile) && entered && exited && dateValid && exited > entered) {
      const start = new Date(`${row.date}T${entered}+08:00`).getTime(), end = new Date(`${row.date}T${exited}+08:00`).getTime()
      const profileKey = officer?.card_uid ?? `name:${normalizeOfficerName(`${row.first_name} ${row.last_name}`)}`
      const key = `${profileKey}|${start}|${end}`
      if (row.included !== false && !issues.length) duplicate = seen.has(key)
      const dayEvents = existing.filter(event => !event.deleted_at && event.card_uid === officer?.card_uid && dateKey(event.timestamp) === row.date)
      const hasIn = dayEvents.some(event => event.type === 'CLOCK_IN' && toDate(event.timestamp).getTime() === start)
      const hasOut = dayEvents.some(event => event.type === 'CLOCK_OUT' && toDate(event.timestamp).getTime() === end)
      const inside = dayEvents.some(event => { const time = toDate(event.timestamp).getTime(); return time > start && time < end })
      if (hasIn && hasOut && !inside) duplicate = true
      else {
        const prior = dayEvents.filter(event => toDate(event.timestamp).getTime() < start).sort((a, b) => toDate(b.timestamp) - toDate(a.timestamp))[0]
        if (hasIn || hasOut || inside || prior?.type === 'CLOCK_IN') issues.push('Overlaps existing attendance. Review the existing entries instead.')
      }
      if (row.included !== false && !issues.length && !duplicate) {
        if (ranges.some(range => range.uid === profileKey && start <= range.end && end >= range.start)) issues.push('Overlaps another selected CSV row. Correct or exclude one visit.')
        else { seen.add(key); ranges.push({ uid: profileKey, start, end }) }
      }
    }
    return { ...row, officer, createsProfile, issues, duplicate, payload: { date: row.date, card_uid: officer?.card_uid,
      time_in: entered, time_out: exited, signature: row.signature ?? '', source: row.source ?? '', notes: row.notes ?? '',
      ...(createsProfile ? { create_profile: true, first_name: (row.first_name ?? '').trim(), last_name: (row.last_name ?? '').trim(), position: row.position?.trim() || 'Officer' } : {}) } }
  })
}
