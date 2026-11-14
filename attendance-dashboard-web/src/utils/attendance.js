import { addDateDays, dateKey, isDayClosed, toDate, weekday, formatTime, formatDuration } from './attendanceTime.js'
import { buildAttendanceSessions } from './attendanceSessions.js'
import { nfcUid } from './officerIdentity.js'

export const DAY_TYPE_LABELS = { regular: 'Regular', no_classes: 'No Classes', optional: 'Optional' }
export const emptyWeek = () => Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { type: 'unscheduled', required_uids: [] }]))
export function semesterForDate(day, context = {}) {
  const { semesters = [], selectedSemesterId } = context
  return semesters.filter(s => (!selectedSemesterId || s.id === selectedSemesterId) && s.start_date <= day && (!s.end_date || day <= s.end_date))
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0] ?? null
}
export function resolveDay(dayValue, context = {}) {
  const day = dateKey(dayValue)
  const semester = semesterForDate(day, context)
  const calendar = (context.calendarDays ?? []).find(d => d.semester_id === semester?.id && d.date === day)
  const versions = (context.scheduleVersions ?? []).filter(v => v.semester_id === semester?.id).sort((a, b) => b.revision - a.revision)
  const version = versions.find(v => v.id === calendar?.schedule_version_id) ?? versions[0]
  const weekly = version?.schedule?.[weekday(day)] ?? { type: 'unscheduled', required_uids: [] }
  const scheduled = calendar?.required_uids != null ? calendar.required_uids.length > 0 : weekly.type === 'scheduled'
  const type = calendar?.type ?? 'regular'
  const scheduledUids = calendar?.required_uids ?? weekly.required_uids ?? []
  return { date: day, semester, type, note: calendar?.note ?? '', schedule_type: scheduled ? 'scheduled' : 'unscheduled',
    scheduled_uids: [...new Set(scheduledUids)], required_uids: type === 'regular' && (scheduled || calendar?.required_uids != null) ? [...new Set(scheduledUids)] : [] }
}
// Preview exactly the dates a weekly save can change. Saved history and explicit
// calendar assignments still resolve normally; this never mutates fetched data.
export function resolveDayWithDraft(dayValue, context = {}, draftSchedule, today = dateKey(), scope = 'today_onward') {
  const saved = resolveDay(dayValue, context)
  const semester = saved.semester
  if (!draftSchedule || semester?.status !== 'active' || semester.id !== context.selectedSemesterId) return saved
  const versions = (context.scheduleVersions ?? []).filter(v => v.semester_id === semester.id)
  const calendar = (context.calendarDays ?? []).find(d => d.semester_id === semester.id && d.date === saved.date)
  const includeHistory = scope === 'whole_semester'
  if (!includeHistory && (calendar?.schedule_version_id || (versions.length > 0 && saved.date < today))) return saved
  return resolveDay(saved.date, {
    ...context,
    calendarDays: includeHistory && calendar?.inherited_unassigned
      ? context.calendarDays.map(row => row === calendar ? { ...row, required_uids: null } : row) : context.calendarDays,
    scheduleVersions: [
      ...(context.scheduleVersions ?? []).filter(v => v.semester_id !== semester.id),
      { id: 'weekly-draft', semester_id: semester.id, revision: 1, schedule: draftSchedule },
    ],
  })
}

export function reportDays(from, to, logs = []) {
  if (!from || !to) return [...new Set(logs.map(l => dateKey(l.timestamp)))].sort()
  if (from > to) throw new Error('From date must be on or before To date.')
  const days = []
  for (let day = from; day <= to; day = addDateDays(day, 1)) {
    if (days.length >= 3700) throw new Error('Choose a report period shorter than ten years.')
    days.push(day)
  }
  return days
}
const matches = (row, query) => !query || [row.officer_name, row.nfc_uid, row.card_uid, row.position, row.status, row.clockIn ? 'clock_in clock in' : '', row.clockOut ? 'clock_out clock out' : ''].some(v => String(v ?? '').toLowerCase().includes(query))
export function analyzeAttendanceData({ logs = [], dateFrom, dateTo, context = {}, officerMap = {}, search = '', now = new Date() } = {}) {
  const sessions = buildAttendanceSessions(logs)
  const days = reportDays(dateFrom, dateTo, logs)
  const query = search.trim().toLowerCase()
  const dailyReports = [], allMasterRows = []
  let finalizedRequired = 0, finalizedAttended = 0
  for (const date of days) {
    const cfg = resolveDay(date, context)
    const snapshot = cfg.semester?.roster_managed || cfg.semester?.status === 'ended' ? cfg.semester.officer_snapshot : null
    const roster = snapshot ? Object.fromEntries(snapshot.map(o => [o.card_uid, o])) : officerMap
    const closed = isDayClosed(date, now), future = date > dateKey(now)
    const attended = new Set(sessions.filter(s => s.date === date && s.clockIn).map(s => s.card_uid))
    const rows = sessions.filter(s => s.date === date).map(s => {
      const officer = roster[s.card_uid] ?? officerMap[s.card_uid]
      const assigned = cfg.required_uids.includes(s.card_uid)
      return { ...s, nfc_uid: nfcUid(officer,s.card_uid), officer_name: s.officer_name || (officer ? `${officer.first_name} ${officer.last_name}` : s.card_uid), position: officer?.position ?? '—', isAssigned: assigned,
        assignment: assigned ? 'Assigned Officer of the Day' : 'Voluntary / Not Required',
        status: !s.clockIn ? 'Needs Review' : s.clockOut ? 'Present' : closed ? 'Incomplete' : 'On Duty',
        clockInTime: formatTime(s.clockIn?.timestamp), clockOutTime: s.clockOut ? formatTime(s.clockOut.timestamp) : 'Not recorded',
        duration: formatDuration(s.clockIn?.timestamp, s.clockOut?.timestamp), isAutoClosed: s.clockOut?.is_auto_closed ? 'Yes' : 'No',
        remarks: s.clockIn?.manually_edited || s.clockOut?.manually_edited ? 'Manually Edited' : '' }
    })
    for (const uid of cfg.required_uids.filter(uid => !attended.has(uid))) {
      const officer = roster[uid]
      rows.push({ date, card_uid: uid, nfc_uid:nfcUid(officer,uid), officer_name: officer ? `${officer.first_name} ${officer.last_name}` : uid, position: officer?.position ?? '—',
        isAssigned: true, assignment: 'Assigned Officer of the Day', status: closed ? 'ABSENT' : 'Pending',
        clockInTime: '—', clockOutTime: '—', duration: '—', isAutoClosed: '—', remarks: closed ? 'Did not attend required duty' : 'Duty has not closed yet' })
    }
    const visible = rows.filter(row => matches(row, query))
    const visibleUids = new Set(visible.map(r => r.card_uid))
    const required = cfg.required_uids.filter(uid => !query || visibleUids.has(uid))
    const requiredAttended = required.filter(uid => attended.has(uid)).length
    const missing = required.length - requiredAttended
    const absentOfficers = visible.filter(r => r.status === 'ABSENT')
    const pendingOfficers = visible.filter(r => r.status === 'Pending')
    let status = cfg.type === 'no_classes' ? 'no_classes' : cfg.type === 'optional' ? 'optional' : cfg.schedule_type === 'unscheduled' && !required.length ? 'unscheduled' : future ? 'future' : required.length && requiredAttended === required.length ? 'full' : !closed ? 'in_progress' : requiredAttended ? 'partial' : required.length ? 'absent' : 'unscheduled'
    const labels = { no_classes: 'No Classes', optional: 'Optional', unscheduled: 'Unscheduled', future: 'Pending', in_progress: 'In Progress', full: 'Full (100%)', partial: `Partial (${required.length ? Math.round(requiredAttended / required.length * 100) : 0}%)`, absent: 'Absent (0%)' }
    if (closed) { finalizedRequired += required.length; finalizedAttended += requiredAttended }
    const voluntarySessions = visible.filter(r => !r.isAssigned)
    const day = { date, dayDate: new Date(`${date}T12:00:00`), dayType: cfg.type, dayTypeLabel: DAY_TYPE_LABELS[cfg.type], dayNote: cfg.note,
      scheduleType: cfg.schedule_type, status, fulfillmentStatus: labels[status], requiredCount: required.length, requiredAttendedCount: requiredAttended,
      requiredAbsentCount: closed ? missing : 0, pendingCount: closed ? 0 : missing, voluntaryOfficersCount: new Set(voluntarySessions.filter(s => s.clockIn).map(s => s.card_uid)).size,
      totalAttendedOfficersCount: [...attended].filter(uid => !query || visibleUids.has(uid)).length,
      assignedSessions: visible.filter(r => r.isAssigned && r.clockIn), absentOfficers, pendingOfficers, voluntarySessions, rows: visible }
    dailyReports.push(day)
    allMasterRows.push(...visible)
  }
  const sum = key => dailyReports.reduce((total, day) => total + day[key], 0)
  return { allDays: days, dailyReports, allMasterRows, summary: { totalDays: days.length, totalRequiredAssignments: sum('requiredCount'), totalRequiredAttended: sum('requiredAttendedCount'),
    totalRequiredAbsent: sum('requiredAbsentCount'), totalPendingAssignments: sum('pendingCount'), totalVoluntarySessions: dailyReports.reduce((n, d) => n + d.voluntarySessions.length, 0),
    overallFulfillmentRate: finalizedRequired ? Math.round(finalizedAttended / finalizedRequired * 100) : null } }
}
