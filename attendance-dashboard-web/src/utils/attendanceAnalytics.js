import { analyzeAttendanceData, resolveDay } from './attendance.js'
import { isDayClosed, toDate, weekday } from './attendanceTime.js'

const rate = (present, required) => required ? Math.round(present / required * 100) : null
const newOfficer = (uid, profile = {}) => ({
  uid, name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || uid,
  position: profile.position || 'Officer', assignedDays: 0, attendedAssignedDays: 0,
  finalizedAssigned: 0, finalizedPresent: 0, absentDays: 0, pendingDays: 0,
  voluntaryDays: 0, visits: 0, seconds: 0, incomplete: 0, openVisits: 0, orphanOuts: 0, autoClosed: 0,
})

// Reuse the calendar/report rules. Count duty slots by officer + school date,
// independently of the number of visits or the number of raw tap events.
export function buildAttendanceAnalytics({ logs = [], context = {}, now = new Date(), ...range } = {}) {
  const analysis = analyzeAttendanceData({ ...range, context, officerMap: context.officerMap ?? {}, now,
    logs: logs.filter(log => !log.deleted_at && toDate(log.timestamp) <= toDate(now)) })
  const officers = new Map()
  const ensure = (uid, profile) => {
    if (!officers.has(uid)) officers.set(uid, newOfficer(uid, profile))
    return officers.get(uid)
  }
  const attendees = new Set()
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(label => ({ label, required: 0, present: 0 }))
  const daily = analysis.dailyReports.map(day => {
    const cfg = resolveDay(day.date, context)
    const roster = cfg.semester?.status === 'ended'
      ? cfg.semester.officer_snapshot ?? [] : (context.officers ?? []).filter(o => o.active !== false)
    for (const profile of roster) ensure(profile.card_uid, profile)
    const closed = isDayClosed(day.date, now)
    const byOfficer = new Map()
    let seconds = 0
    for (const row of day.rows) {
      const officer = ensure(row.card_uid)
      officer.name = row.officer_name
      officer.position = row.position === '—' ? officer.position : row.position
      if (!byOfficer.has(row.card_uid)) byOfficer.set(row.card_uid, { assigned: false, attended: false })
      const slot = byOfficer.get(row.card_uid)
      slot.assigned ||= row.isAssigned
      slot.attended ||= Boolean(row.clockIn)
      if (row.clockIn) { officer.visits++; attendees.add(row.card_uid) }
      if (row.clockIn && row.clockOut) {
        const duration = Math.max(0, Math.floor((toDate(row.clockOut.timestamp) - toDate(row.clockIn.timestamp)) / 1000))
        officer.seconds += duration
        seconds += duration
        if (row.clockOut.is_auto_closed) officer.autoClosed++
      } else if (row.clockIn) {
        if (closed) officer.incomplete++
        else officer.openVisits++
      } else if (row.clockOut) officer.orphanOuts++
    }
    for (const [uid, slot] of byOfficer) {
      const officer = ensure(uid)
      if (slot.assigned) {
        officer.assignedDays++
        if (slot.attended) officer.attendedAssignedDays++
        if (closed) {
          officer.finalizedAssigned++
          if (slot.attended) officer.finalizedPresent++
          else officer.absentDays++
        } else if (!slot.attended) officer.pendingDays++
      } else if (slot.attended) officer.voluntaryDays++
    }
    const bucket = weekdays[weekday(day.date)]
    if (closed) { bucket.required += day.requiredCount; bucket.present += day.requiredAttendedCount }
    return { date: day.date, type: day.dayTypeLabel, closed, required: day.requiredCount,
      present: day.requiredAttendedCount, absent: day.requiredAbsentCount, pending: day.pendingCount,
      volunteers: day.voluntaryOfficersCount, seconds }
  })
  const rows = [...officers.values()].map(officer => ({ ...officer, rate: rate(officer.finalizedPresent, officer.finalizedAssigned) }))
  const sum = key => rows.reduce((total, officer) => total + officer[key], 0)
  return { daily, officers: rows, weekdays: weekdays.map(day => ({ ...day, rate: rate(day.present, day.required) })),
    summary: { rate: analysis.summary.overallFulfillmentRate, required: sum('finalizedAssigned'),
      present: sum('finalizedPresent'), absent: sum('absentDays'), pending: sum('pendingDays'),
      uniqueAttendees: attendees.size, visits: sum('visits'), seconds: sum('seconds'),
      voluntaryDays: sum('voluntaryDays'), incomplete: sum('incomplete'), openVisits: sum('openVisits'),
      orphanOuts: sum('orphanOuts'), autoClosed: sum('autoClosed') } }
}

// Keep long semesters readable without dropping dates: combine every day into
// at most 24 consecutive buckets, including days without taps.
export function bucketAttendanceTrend(days, maxBuckets = 24) {
  const size = Math.max(1, Math.ceil(days.length / maxBuckets))
  const buckets = []
  for (let index = 0; index < days.length; index += size) {
    const group = days.slice(index, index + size)
    const total = key => group.reduce((sum, day) => sum + day[key], 0)
    buckets.push({ from: group[0].date, to: group.at(-1).date,
      present: total('present'), absent: total('absent'), pending: total('pending'), volunteers: total('volunteers') })
  }
  return buckets
}
