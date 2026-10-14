// utils/reportExport.js
// --------------------
// Core export & attendance analytics engine for Council NFC Attendance System.
// Generates:
// 1. Multi-sheet Excel (.xlsx) workbooks:
//    - "Overview": High-level attendance KPIs & day-by-day fulfillment summary
//    - "All Records": Unified searchable master log with assignment distinction
//    - "YYYY-MM-DD": Dedicated daily sheets categorizing:
//        * 📌 Assigned Officers of the Day (Present & Absent)
//        * ⭐ Additional Attendees (Attended even if not required / Voluntary)
// 2. Session-grouped CSV reports with Assignment distinction.

import * as XLSX from 'xlsx'
import {
  format, parseISO, getDay, isSameDay, eachDayOfInterval,
  startOfDay, endOfDay, max, min,
} from 'date-fns'
import { collection, getDocs } from 'firebase/firestore'

// ── Built-in Day Defaults ───────────────────────────────────────────────────
export const BUILTIN_DEFAULTS = {
  0: { type: 'no_classes', required_uids: [], label: 'No Classes' },
  1: { type: 'regular',    required_uids: [], label: 'Regular' },
  2: { type: 'regular',    required_uids: [], label: 'Regular' },
  3: { type: 'regular',    required_uids: [], label: 'Regular' },
  4: { type: 'regular',    required_uids: [], label: 'Regular' },
  5: { type: 'regular',    required_uids: [], label: 'Regular' },
  6: { type: 'no_classes', required_uids: [], label: 'No Classes' },
}

export const DAY_TYPE_LABELS = {
  regular:    'Regular Day',
  holiday:    'Holiday',
  no_classes: 'No Classes',
  optional:   'Optional Attendance',
}

// ── Priority resolution: specific date > weekly (if >= effectiveFrom) > builtin
export function resolveDay(dayDate, dayConfigMap = {}, weeklySchedule = null, weeklyEffectiveFrom = null) {
  const dateObj = typeof dayDate === 'string' ? parseISO(dayDate) : dayDate
  const ds = format(dateObj, 'yyyy-MM-dd')

  // 1. Specific date override
  if (dayConfigMap[ds]) {
    return {
      type: dayConfigMap[ds].type ?? 'regular',
      required_uids: dayConfigMap[ds].required_uids ?? [],
      note: dayConfigMap[ds].note ?? '',
    }
  }

  // 2. Weekly recurring schedule (only if date >= effective_from)
  if (weeklySchedule && weeklyEffectiveFrom && ds >= weeklyEffectiveFrom) {
    const dow = getDay(dateObj)
    if (weeklySchedule[dow]) {
      return {
        type: weeklySchedule[dow].type ?? 'regular',
        required_uids: weeklySchedule[dow].required_uids ?? [],
        note: weeklySchedule[dow].note ?? '',
      }
    }
  }

  // 3. Built-in defaults (Sun/Sat = no_classes, others = regular)
  const def = BUILTIN_DEFAULTS[getDay(dateObj)] ?? { type: 'regular', required_uids: [], note: '' }
  return {
    type: def.type,
    required_uids: def.required_uids ?? [],
    note: def.note ?? '',
  }
}

// ── Fetch Day Config & Officers in parallel ───────────────────────────────────
export async function fetchAttendanceContext(db, selectedSemesterId = null, semesters = []) {
  const activeSem = semesters.find(s => s.id === selectedSemesterId)
  const hasSnapshot = activeSem?.officer_snapshot && activeSem.officer_snapshot.length > 0

  const [dayConfigSnap, officersSnap] = await Promise.all([
    getDocs(collection(db, 'day_config')),
    hasSnapshot ? Promise.resolve(null) : getDocs(collection(db, 'officers')),
  ])

  const dayConfigMap = {}
  let weeklySchedule = null
  let weeklyEffectiveFrom = null

  dayConfigSnap.forEach(docSnap => {
    const data = docSnap.data()
    if (docSnap.id === 'weekly') {
      weeklyEffectiveFrom = data.effective_from ?? null
      if (data.schedule) {
        weeklySchedule = {}
        Object.entries(data.schedule).forEach(([k, v]) => {
          weeklySchedule[Number(k)] = v
        })
      }
    } else {
      dayConfigMap[docSnap.id] = data
    }
  })

  let officersList = []
  if (hasSnapshot) {
    officersList = activeSem.officer_snapshot
  } else if (officersSnap) {
    officersList = officersSnap.docs.map(d => ({ card_uid: d.id, ...d.data() }))
  }

  const officerMap = {}
  officersList.forEach(o => {
    if (o.card_uid) officerMap[o.card_uid] = o
  })

  return {
    dayConfigMap,
    weeklySchedule,
    weeklyEffectiveFrom,
    officers: officersList,
    officerMap,
  }
}

// ── Format Helpers ───────────────────────────────────────────────────────────
export function formatTime(ts) {
  if (!ts) return '—'
  const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts))
  if (isNaN(d.getTime())) return '—'
  return format(d, 'hh:mm:ss a')
}

export function formatDate(ts) {
  if (!ts) return '—'
  const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts))
  if (isNaN(d.getTime())) return '—'
  return format(d, 'yyyy-MM-dd')
}

export function formatDuration(clockInTs, clockOutTs) {
  if (!clockInTs || !clockOutTs) return '—'
  const dIn  = clockInTs?.toDate  ? clockInTs.toDate()  : (clockInTs instanceof Date  ? clockInTs  : new Date(clockInTs))
  const dOut = clockOutTs?.toDate ? clockOutTs.toDate() : (clockOutTs instanceof Date ? clockOutTs : new Date(clockOutTs))
  if (isNaN(dIn.getTime()) || isNaN(dOut.getTime())) return '—'
  const diffMs = Math.max(0, dOut.getTime() - dIn.getTime())
  const h = Math.floor(diffMs / 3600000)
  const m = Math.floor((diffMs % 3600000) / 60000)
  const s = Math.floor((diffMs % 60000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── Group Flat Logs into Daily Sessions with Assignment Distinction ──────────
export function analyzeAttendanceData({
  logs = [],
  dateFrom = null,
  dateTo = null,
  officerMap = {},
  dayConfigMap = {},
  weeklySchedule = null,
  weeklyEffectiveFrom = null,
}) {
  // Sort logs chronologically
  const ascLogs = [...logs].sort((a, b) => {
    const ta = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : new Date(a.timestamp || 0).getTime()
    const tb = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : new Date(b.timestamp || 0).getTime()
    return ta - tb
  })

  // Group logs by YYYY-MM-DD
  const logsByDay = {}
  for (const log of ascLogs) {
    const d = log.timestamp?.toDate ? log.timestamp.toDate() : new Date(log.timestamp || 0)
    if (isNaN(d.getTime())) continue
    const ds = format(d, 'yyyy-MM-dd')
    if (!logsByDay[ds]) logsByDay[ds] = []
    logsByDay[ds].push(log)
  }

  // Determine interval of days to include in the report
  let allDays = []
  if (dateFrom && dateTo) {
    try {
      const d1 = parseISO(dateFrom)
      const d2 = parseISO(dateTo)
      const start = min([d1, d2])
      const end   = max([d1, d2])
      allDays = eachDayOfInterval({ start, end }).map(d => format(d, 'yyyy-MM-dd'))
    } catch {
      allDays = Object.keys(logsByDay).sort()
    }
  } else {
    allDays = Object.keys(logsByDay).sort()
  }

  // Process day by day
  const dailyReports = []
  const allMasterRows = []

  let grandTotalRequiredAssignments = 0
  let grandTotalRequiredAttended    = 0
  let grandTotalRequiredAbsent      = 0
  let grandTotalVoluntarySessions   = 0

  for (const ds of allDays) {
    const dayDate = parseISO(ds)
    const dayCfg = resolveDay(dayDate, dayConfigMap, weeklySchedule, weeklyEffectiveFrom)
    const dayLogs = logsByDay[ds] || []
    const requiredUids = dayCfg.required_uids || []

    // Build sessions for this day
    const openSessions = {}
    const daySessions = []

    for (const log of dayLogs) {
      const uid = log.card_uid
      const officer = officerMap[uid]
      const name = log.officer_name || (officer ? `${officer.first_name} ${officer.last_name}` : uid)

      if (log.type === 'CLOCK_IN') {
        const s = {
          officer_name: name,
          card_uid: uid,
          position: officer?.position || '—',
          clockIn: log,
          clockOut: null,
        }
        openSessions[uid] = s
        daySessions.push(s)
      } else if (log.type === 'CLOCK_OUT') {
        if (openSessions[uid]) {
          openSessions[uid].clockOut = log
          delete openSessions[uid]
        } else {
          daySessions.push({
            officer_name: name,
            card_uid: uid,
            position: officer?.position || '—',
            clockIn: null,
            clockOut: log,
          })
        }
      }
    }

    const attendedUids = new Set(daySessions.map(s => s.card_uid))

    // Categorize into Assigned OOTD vs Additional / Voluntary Attendees
    const assignedSessions = []
    const voluntarySessions = []

    for (const s of daySessions) {
      const isAssigned = requiredUids.includes(s.card_uid)
      const assignment = isAssigned ? 'Assigned Officer of the Day' : 'Voluntary / Not Required'
      const status = s.clockOut ? 'Present' : (s.clockIn ? 'On Duty' : 'Present')
      const duration = formatDuration(s.clockIn?.timestamp, s.clockOut?.timestamp)
      const isAuto = s.clockOut?.is_auto_closed ? 'Yes' : 'No'
      const remarks = s.clockIn?.manually_edited || s.clockOut?.manually_edited ? 'Manually Edited' : ''

      const enriched = {
        date: ds,
        officer_name: s.officer_name,
        position: s.position,
        card_uid: s.card_uid,
        assignment,
        status,
        clockInTime: formatTime(s.clockIn?.timestamp),
        clockOutTime: s.clockOut ? formatTime(s.clockOut.timestamp) : (s.clockIn ? '🟢 On Duty' : '—'),
        duration,
        isAutoClosed: isAuto,
        remarks,
        isAssigned,
      }

      if (isAssigned) {
        assignedSessions.push(enriched)
      } else {
        voluntarySessions.push(enriched)
        grandTotalVoluntarySessions++
      }

      allMasterRows.push(enriched)
    }

    // Identify absent required officers
    const absentOfficers = []
    for (const reqUid of requiredUids) {
      if (!attendedUids.has(reqUid)) {
        const off = officerMap[reqUid]
        const absentRecord = {
          date: ds,
          officer_name: off ? `${off.first_name} ${off.last_name}` : reqUid,
          position: off?.position || '—',
          card_uid: reqUid,
          assignment: 'Assigned Officer of the Day',
          status: 'ABSENT',
          clockInTime: '—',
          clockOutTime: '—',
          duration: '—',
          isAutoClosed: '—',
          remarks: 'Did not attend required duty',
          isAssigned: true,
        }
        absentOfficers.push(absentRecord)
        allMasterRows.push(absentRecord)
      }
    }

    // Required metrics for this day
    const reqCount = requiredUids.length
    const reqAttendedCount = requiredUids.filter(u => attendedUids.has(u)).length
    const reqAbsentCount = absentOfficers.length
    const volCount = new Set(voluntarySessions.map(s => s.card_uid)).size
    const totalAttendedCount = attendedUids.size

    grandTotalRequiredAssignments += reqCount
    grandTotalRequiredAttended    += reqAttendedCount
    grandTotalRequiredAbsent      += reqAbsentCount

    let fulfillmentStatus = 'N/A'
    if (dayCfg.type === 'holiday') {
      fulfillmentStatus = 'Holiday'
    } else if (dayCfg.type === 'no_classes') {
      fulfillmentStatus = 'No Classes'
    } else if (dayCfg.type === 'optional') {
      fulfillmentStatus = totalAttendedCount > 0 ? 'Attended' : 'Optional'
    } else {
      if (reqCount === 0) {
        fulfillmentStatus = totalAttendedCount > 0 ? 'Attended' : 'No Schedule'
      } else if (reqAttendedCount >= reqCount) {
        fulfillmentStatus = 'Full (100%)'
      } else if (reqAttendedCount > 0) {
        fulfillmentStatus = `Partial (${Math.round((reqAttendedCount / reqCount) * 100)}%)`
      } else {
        fulfillmentStatus = 'Absent (0%)'
      }
    }

    dailyReports.push({
      date: ds,
      dayDate,
      dayType: dayCfg.type,
      dayTypeLabel: DAY_TYPE_LABELS[dayCfg.type] || dayCfg.type,
      dayNote: dayCfg.note,
      requiredCount: reqCount,
      requiredAttendedCount: reqAttendedCount,
      requiredAbsentCount: reqAbsentCount,
      voluntaryOfficersCount: volCount,
      totalAttendedOfficersCount: totalAttendedCount,
      fulfillmentStatus,
      assignedSessions,
      absentOfficers,
      voluntarySessions,
    })
  }

  return {
    allDays,
    dailyReports,
    allMasterRows,
    summary: {
      totalDays: allDays.length,
      totalRequiredAssignments: grandTotalRequiredAssignments,
      totalRequiredAttended: grandTotalRequiredAttended,
      totalRequiredAbsent: grandTotalRequiredAbsent,
      totalVoluntarySessions: grandTotalVoluntarySessions,
      overallFulfillmentRate: grandTotalRequiredAssignments > 0
        ? Math.round((grandTotalRequiredAttended / grandTotalRequiredAssignments) * 100)
        : (grandTotalRequiredAttended > 0 ? 100 : 0),
    },
  }
}

// ── Export Multi-sheet XLSX ───────────────────────────────────────────────────
export function exportXLSXReport({
  logs = [],
  dateFrom,
  dateTo,
  selectedSemester,
  semesters = [],
  officerMap = {},
  dayConfigMap = {},
  weeklySchedule = null,
  weeklyEffectiveFrom = null,
}) {
  const analysis = analyzeAttendanceData({
    logs,
    dateFrom,
    dateTo,
    officerMap,
    dayConfigMap,
    weeklySchedule,
    weeklyEffectiveFrom,
  })

  const wb = XLSX.utils.book_new()
  const activeSem = semesters.find(s => s.id === selectedSemester)
  const rangeLabel = activeSem ? activeSem.name : `${dateFrom} to ${dateTo}`

  // ───────────────────────────────────────────────────────────────────────────
  // SHEET 1: Overview & Summary
  // ───────────────────────────────────────────────────────────────────────────
  const overviewAoa = [
    ['SUPREME STUDENT COUNCIL — ATTENDANCE REPORT SUMMARY'],
    [`Report Period: ${rangeLabel}`, '', '', `Generated: ${format(new Date(), 'yyyy-MM-dd hh:mm a')}`],
    [],
    ['KEY PERFORMANCE INDICATORS (KPIs)'],
    ['Total Days in Scope', analysis.summary.totalDays],
    ['Total Required Duty Slots', analysis.summary.totalRequiredAssignments],
    ['Required Slots Attended', analysis.summary.totalRequiredAttended],
    ['Required Slots Absent', analysis.summary.totalRequiredAbsent],
    ['Voluntary Attendance Sessions', analysis.summary.totalVoluntarySessions],
    ['Required Duty Fulfillment Rate', `${analysis.summary.overallFulfillmentRate}%`],
    [],
    ['DAY-BY-DAY ATTENDANCE SUMMARY'],
    [
      'Date',
      'Day of Week',
      'Day Type',
      'Required Officers',
      'Attended (Required)',
      'Absent (Required)',
      'Voluntary Attendees',
      'Total Officers Present',
      'Fulfillment Status',
      'Notes',
    ],
  ]

  for (const dr of analysis.dailyReports) {
    overviewAoa.push([
      dr.date,
      format(dr.dayDate, 'EEEE'),
      dr.dayTypeLabel,
      dr.requiredCount,
      dr.requiredAttendedCount,
      dr.requiredAbsentCount,
      dr.voluntaryOfficersCount,
      dr.totalAttendedOfficersCount,
      dr.fulfillmentStatus,
      dr.dayNote || '',
    ])
  }

  const wsOverview = XLSX.utils.aoa_to_sheet(overviewAoa)
  wsOverview['!cols'] = [
    { wch: 14 }, // Date
    { wch: 14 }, // Day
    { wch: 18 }, // Type
    { wch: 18 }, // Required
    { wch: 20 }, // Attended
    { wch: 18 }, // Absent
    { wch: 20 }, // Voluntary
    { wch: 22 }, // Total
    { wch: 18 }, // Status
    { wch: 30 }, // Notes
  ]
  wsOverview['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
  ]
  XLSX.utils.book_append_sheet(wb, wsOverview, 'Overview & Summary')

  // ───────────────────────────────────────────────────────────────────────────
  // SHEET 2: Master Log (All Records with Assignment distinction)
  // ───────────────────────────────────────────────────────────────────────────
  const masterAoa = [
    ['MASTER ATTENDANCE LOG — ALL RECORDS'],
    [`Period: ${rangeLabel}`, '', '', '', `Total Entries: ${analysis.allMasterRows.length}`],
    [],
    [
      'Date',
      'Officer Name',
      'Position',
      'Card UID',
      'Assignment Type',
      'Attendance Status',
      'Clock In',
      'Clock Out',
      'Duration',
      'Auto-Closed',
      'Remarks',
    ],
  ]

  for (const r of analysis.allMasterRows) {
    masterAoa.push([
      r.date,
      r.officer_name,
      r.position,
      r.card_uid,
      r.assignment,
      r.status,
      r.clockInTime,
      r.clockOutTime,
      r.duration,
      r.isAutoClosed,
      r.remarks,
    ])
  }

  const wsMaster = XLSX.utils.aoa_to_sheet(masterAoa)
  wsMaster['!cols'] = [
    { wch: 14 }, // Date
    { wch: 28 }, // Name
    { wch: 22 }, // Position
    { wch: 14 }, // Card UID
    { wch: 32 }, // Assignment Type
    { wch: 18 }, // Status
    { wch: 14 }, // Clock In
    { wch: 14 }, // Clock Out
    { wch: 14 }, // Duration
    { wch: 14 }, // Auto-Closed
    { wch: 26 }, // Remarks
  ]
  wsMaster['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
  ]
  XLSX.utils.book_append_sheet(wb, wsMaster, 'All Records (Master)')

  // ───────────────────────────────────────────────────────────────────────────
  // DAILY SHEETS: One sheet per day (Named YYYY-MM-DD)
  // ───────────────────────────────────────────────────────────────────────────
  // If the period has <= 31 days, include every day.
  // If longer (e.g. 120-day semester), only include days with logs or configured duty.
  const daysToInclude = analysis.dailyReports.filter(dr => {
    if (analysis.dailyReports.length <= 31) return true
    return (
      dr.assignedSessions.length > 0 ||
      dr.absentOfficers.length > 0 ||
      dr.voluntarySessions.length > 0 ||
      dr.requiredCount > 0
    )
  })

  for (const dr of daysToInclude) {
    const sheetName = dr.date // YYYY-MM-DD (10 chars, safe & unique)
    const dayHeader = format(dr.dayDate, 'EEEE, MMMM d, yyyy')

    const dayAoa = [
      ['SUPREME STUDENT COUNCIL — DAILY ATTENDANCE RECORD'],
      [`Date: ${dayHeader}  |  Day Type: ${dr.dayTypeLabel}${dr.dayNote ? `  |  Note: ${dr.dayNote}` : ''}`],
      [
        `Summary: Required: ${dr.requiredCount}  |  Present (Required): ${dr.requiredAttendedCount}  |  Absent: ${dr.requiredAbsentCount}  |  Voluntary Attendees: ${dr.voluntaryOfficersCount}  |  Total Present: ${dr.totalAttendedOfficersCount}`,
      ],
      [],
      ['📌 SECTION 1: ASSIGNED OFFICERS OF THE DAY (Required Duty)'],
      [
        'Officer Name',
        'Position',
        'Card UID',
        'Assignment',
        'Status',
        'Clock In',
        'Clock Out',
        'Duration',
        'Auto-Closed',
        'Remarks',
      ],
    ]

    // 1. Assigned officers who attended
    if (dr.assignedSessions.length > 0) {
      for (const s of dr.assignedSessions) {
        dayAoa.push([
          s.officer_name,
          s.position,
          s.card_uid,
          s.assignment,
          s.status,
          s.clockInTime,
          s.clockOutTime,
          s.duration,
          s.isAutoClosed,
          s.remarks,
        ])
      }
    }

    // 2. Assigned officers who were ABSENT
    if (dr.absentOfficers.length > 0) {
      for (const a of dr.absentOfficers) {
        dayAoa.push([
          a.officer_name,
          a.position,
          a.card_uid,
          a.assignment,
          a.status,
          a.clockInTime,
          a.clockOutTime,
          a.duration,
          a.isAutoClosed,
          a.remarks,
        ])
      }
    }

    if (dr.assignedSessions.length === 0 && dr.absentOfficers.length === 0) {
      dayAoa.push(['No assigned officers scheduled for this date.', '', '', '', '', '', '', '', '', ''])
    }

    // 3. Voluntary / Additional attendees
    dayAoa.push([])
    dayAoa.push(['⭐ SECTION 2: ADDITIONAL ATTENDEES (Attended, Not Required)'])
    dayAoa.push([
      'Officer Name',
      'Position',
      'Card UID',
      'Assignment',
      'Status',
      'Clock In',
      'Clock Out',
      'Duration',
      'Auto-Closed',
      'Remarks',
    ])

    if (dr.voluntarySessions.length > 0) {
      for (const v of dr.voluntarySessions) {
        dayAoa.push([
          v.officer_name,
          v.position,
          v.card_uid,
          v.assignment,
          v.status,
          v.clockInTime,
          v.clockOutTime,
          v.duration,
          v.isAutoClosed,
          v.remarks,
        ])
      }
    } else {
      dayAoa.push(['No additional non-required attendees for this date.', '', '', '', '', '', '', '', '', ''])
    }

    const wsDay = XLSX.utils.aoa_to_sheet(dayAoa)
    wsDay['!cols'] = [
      { wch: 28 }, // Name
      { wch: 22 }, // Position
      { wch: 14 }, // Card UID
      { wch: 32 }, // Assignment
      { wch: 18 }, // Status
      { wch: 14 }, // Clock In
      { wch: 14 }, // Clock Out
      { wch: 14 }, // Duration
      { wch: 14 }, // Auto-Closed
      { wch: 26 }, // Remarks
    ]
    wsDay['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 8 } },
    ]
    XLSX.utils.book_append_sheet(wb, wsDay, sheetName)
  }

  // Trigger browser download
  const safeLabel = rangeLabel.replace(/[\s/\\?%*:|"<>]+/g, '_').toLowerCase()
  const filename = `attendance_report_${safeLabel}.xlsx`
  XLSX.writeFile(wb, filename)

  return {
    filename,
    sheetsCount: wb.SheetNames.length,
    totalRecords: analysis.allMasterRows.length,
  }
}

// ── Export Session-Grouped CSV with Assignment Distinction ───────────────────
export function exportCSVReport({
  logs = [],
  label = 'export',
  officerMap = {},
  dayConfigMap = {},
  weeklySchedule = null,
  weeklyEffectiveFrom = null,
}) {
  const analysis = analyzeAttendanceData({
    logs,
    officerMap,
    dayConfigMap,
    weeklySchedule,
    weeklyEffectiveFrom,
  })

  const header = [
    'Date',
    'Officer Name',
    'Position',
    'Card UID',
    'Assignment Type',
    'Status',
    'Clock In',
    'Clock Out',
    'Duration',
    'Auto-Closed',
    'Remarks',
  ]

  const rows = analysis.allMasterRows.map(r => [
    r.date,
    r.officer_name,
    r.position,
    r.card_uid,
    r.assignment,
    r.status,
    r.clockInTime,
    r.clockOutTime,
    r.duration,
    r.isAutoClosed,
    r.remarks,
  ])

  const csv = [header, ...rows]
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `attendance_${label}.csv`
  a.click()
  URL.revokeObjectURL(url)

  return analysis.allMasterRows.length
}
