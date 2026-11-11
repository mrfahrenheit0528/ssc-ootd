import * as XLSX from 'xlsx'
import { serializeCSV } from './csv.js'
import { listRecords } from '../data.js'
import { analyzeAttendanceData, resolveDay, DAY_TYPE_LABELS } from './attendance.js'
import { dateKey, formatTime, formatDuration } from './attendanceTime.js'
export { analyzeAttendanceData, resolveDay, DAY_TYPE_LABELS, formatTime, formatDuration }
export const formatDate = value => value ? dateKey(value) : '?'

export async function fetchAttendanceContext(selectedSemesterId = null, semesters = []) {
  const [calendarDays, scheduleVersions, officers, terms] = await Promise.all([
    listRecords('calendar_days'), listRecords('semester_schedules'), listRecords('officers',{includeInactive:true}),
    semesters.length ? Promise.resolve(semesters) : listRecords('semesters'),
  ])
  return { selectedSemesterId, semesters: terms, calendarDays, scheduleVersions, officers,
    officerMap: Object.fromEntries(officers.map(o => [o.card_uid, o])) }
}

const HEADER = ['Date', 'Officer Name', 'Position', 'Card UID', 'Assignment Type', 'Attendance Status', 'Clock In', 'Clock Out', 'Duration', 'Auto-Closed', 'Remarks']
const values = row => [row.date, row.officer_name, row.position, row.nfc_uid ?? '', row.assignment, row.status, row.clockInTime, row.clockOutTime, row.duration, row.isAutoClosed, row.remarks]
export function exportXLSXReport(options = {}) {
  const analysis = analyzeAttendanceData(options)
  const { dateFrom, dateTo, selectedSemester, semesters = [] } = options
  const semester = semesters.find(s => s.id === selectedSemester)
  const rangeLabel = semester ? `${semester.name}: ${dateFrom} to ${dateTo}` : `${dateFrom} to ${dateTo}`
  const workbook = XLSX.utils.book_new()
  const summary = analysis.summary
  const overview = [
    ['SSC ATTENDANCE REPORT SUMMARY'], [`Report Period: ${rangeLabel}`], [],
    ['Total Days in Scope', summary.totalDays],
    ['Total Required Duty Slots', summary.totalRequiredAssignments],
    ['Required Slots Attended', summary.totalRequiredAttended], ['Required Slots Absent', summary.totalRequiredAbsent],
    ['Pending Duty Slots', summary.totalPendingAssignments],
    ['Voluntary Attendance Sessions', summary.totalVoluntarySessions],
    ['Fulfillment Rate (finalized days)', summary.overallFulfillmentRate == null ? 'Not finalized' : `${summary.overallFulfillmentRate}%`], [],
    ['Date', 'Day Type', 'Schedule', 'Required', 'Assigned Present', 'Absent', 'Pending', 'Volunteers', 'Total Officers Present', 'Status', 'Note'],
    ...analysis.dailyReports.map(d => [d.date,d.dayTypeLabel,d.scheduleType,d.requiredCount,d.requiredAttendedCount,d.requiredAbsentCount,d.pendingCount,d.voluntaryOfficersCount,d.totalAttendedOfficersCount,d.fulfillmentStatus,d.dayNote]),
  ]
  const append = (name, rows) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!cols'] = Array.from({ length: 11 }, (_, i) => ({ wch: [1,4,10].includes(i) ? 32 : 19 }))
    sheet['!merges'] = [0,1].map(r => ({s:{r,c:0},e:{r,c:10}}))
    if (name === 'All Records (Master)') sheet['!autofilter'] = {ref:`A4:K${Math.max(rows.length,4)}`}
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  }
  append('Overview & Summary', overview)
  append('All Records (Master)', [['MASTER ATTENDANCE LOG'], [`Period: ${rangeLabel}`], [], HEADER, ...analysis.allMasterRows.map(values)])
  for (const day of analysis.dailyReports.filter(d => analysis.dailyReports.length <= 31 || d.rows.length)) {
    append(day.date, [['SSC DAILY ATTENDANCE RECORD'], [`${day.date} | ${day.dayTypeLabel} | ${day.scheduleType}`],
      [`${day.fulfillmentStatus} | Assigned present: ${day.requiredAttendedCount}/${day.requiredCount} | Absent: ${day.requiredAbsentCount} | Pending: ${day.pendingCount} | Volunteers: ${day.voluntaryOfficersCount}`],
      [day.dayNote], [], ['ASSIGNED OFFICERS OF THE DAY'], HEADER,
      ...day.rows.filter(r => r.isAssigned).map(values), [], ['ADDITIONAL / VOLUNTARY ATTENDEES'], HEADER,
      ...day.rows.filter(r => !r.isAssigned).map(values)])
  }
  const safeLabel = rangeLabel.replace(/[\s/\\?%*:|"<>]+/g, '_').toLowerCase()
  const filename = `attendance_report_${safeLabel}.xlsx`
  XLSX.writeFile(workbook, filename)
  return { filename, sheetsCount: workbook.SheetNames.length, totalRecords: analysis.allMasterRows.length }
}
export function exportCSVReport(options = {}) {
  const analysis = analyzeAttendanceData(options)
  const csv = serializeCSV([HEADER, ...analysis.allMasterRows.map(values)])
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `attendance_${options.label ?? 'export'}.csv`
  a.click()
  URL.revokeObjectURL(url)
  return analysis.allMasterRows.length
}
