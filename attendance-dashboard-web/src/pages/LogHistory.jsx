// pages/LogHistory.jsx
// --------------------
// Attendance sessions with paired clock-in/out times, date filters, search, and exports.
// Admins also get: edit entry, delete entry, add manual entry.

import Select from '../components/Select'
import AttendanceImportModal from '../components/AttendanceImportModal'
import { nfcUid } from '../utils/officerIdentity'
import { useState, useEffect, useRef } from 'react'
import { listRecords, deleteRecord, saveAttendance, importAttendanceCSV, recoverAttendance, Instant } from '../data'
import { useAuth } from '../contexts/AuthContext'
import { useSemester } from '../contexts/SemesterContext'
import { useHistoryFilters } from '../hooks/useHistoryFilters'
import { format } from 'date-fns'
import { dateKey, dateBounds, timeInput } from '../utils/attendanceTime'
import toast from 'react-hot-toast'
import {
  History, Search, Download, LogIn, LogOut, RefreshCw,
  Plus, Pencil, Trash2, X, Save, GraduationCap, FileSpreadsheet, Upload,
} from 'lucide-react'
import {
  resolveDay, fetchAttendanceContext, formatTime, formatDuration,
  exportXLSXReport, exportCSVReport,
} from '../utils/reportExport'
import { buildAttendanceSessions, filterAttendanceSessions } from '../utils/attendanceSessions'

const loadImportOfficers = () => listRecords('officers', { includeInactive: true })
const loadImportExisting = bounds => listRecords('attendance_logs', { ...bounds, orderBy: 'timestamp' })

// ── Quick presets ─────────────────────────────────────────────────────────────
const PRESETS = [
  { label: 'Today',        days: 0 },
  { label: 'Yesterday',    days: 1 },
  { label: 'Last 7 days',  days: 7 },
  { label: 'Last 30 days', days: 30 },
]

// ── Log Edit Modal (admin only) ───────────────────────────────────────────────
function LogEditModal({ log, officers, onClose, onSave }) {
  const isAdd  = !log
  const [officerUid, setOfficerUid] = useState(log?.card_uid ?? '')
  const [type,       setType]       = useState(log?.type ?? 'CLOCK_IN')
  const [dateStr,    setDateStr]    = useState(
    dateKey(log?.timestamp ?? new Date())
  )
  const [timeStr, setTimeStr] = useState(
    timeInput(log?.timestamp ?? new Date())
  )
  const [isAuto, setIsAuto]   = useState(log?.is_auto_closed ?? false)
  const [saving, setSaving]   = useState(false)
  const [reason, setReason] = useState('')

  const selectedOfficer = officers.find(o => o.card_uid === officerUid)

  const handleSave = async () => {
    if (!officerUid.trim()) return toast.error('Officer is required.')
    if (reason.trim().length < 3) return toast.error('Enter a correction reason of at least 3 characters.')
    setSaving(true)
    try {
      const unchanged = log && dateStr === dateKey(log.timestamp) && timeStr === timeInput(log.timestamp)
      const ts = unchanged ? log.timestamp.toDate() : new Date(`${dateStr}T${timeStr.length === 5 ? timeStr + ':00' : timeStr}+08:00`)
      const payload = {
        card_uid:        officerUid.toUpperCase().trim(),
        officer_name:    selectedOfficer ? `${selectedOfficer.first_name} ${selectedOfficer.last_name}` : officerUid,
        type,
        timestamp:       unchanged ? log.timestamp : Instant.fromDate(ts),
        is_auto_closed:  isAuto,
        manually_edited: true,
      }
      await saveAttendance(log?.id, payload, reason)
      toast.success(isAdd ? 'Log entry added.' : 'Log entry updated.')
      onSave()
    } catch (err) {
      toast.error(`Error: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="card w-full max-w-md p-6 space-y-5 animate-slide-up">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-white text-lg">{isAdd ? 'Add Manual Entry' : 'Edit Log Entry'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Officer */}
          <div>
            <label className="label">Officer</label>
            {officers.length > 0 ? (
              <Select aria-label="Officer" className="input" disabled={saving} value={officerUid} onChange={e => setOfficerUid(e.target.value)}>
                <option value="">— Select officer —</option>
                {officers.map(o => (
                  <option key={o.card_uid} value={o.card_uid}>
                    {o.first_name} {o.last_name} ({nfcUid(o) || 'No card linked'})
                  </option>
                ))}
              </Select>
            ) : (
              <input className="input font-mono" placeholder="Card UID"
                value={officerUid} onChange={e => setOfficerUid(e.target.value)} />
            )}
          </div>

          {/* Action type */}
          <div>
            <label className="label">Action</label>
            <div className="flex gap-3">
              {['CLOCK_IN', 'CLOCK_OUT'].map(t => (
                <label key={t} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border cursor-pointer text-sm font-medium transition-colors
                  ${type === t ? 'bg-brand-500/15 border-brand-500/40 text-brand-300' : 'border-white/10 text-slate-400 hover:bg-white/5'}`}>
                  <input type="radio" name="log-type" value={t} checked={type === t}
                    onChange={() => setType(t)} className="hidden" />
                  {t === 'CLOCK_IN' ? <LogIn className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
                  {t === 'CLOCK_IN' ? 'Clock In' : 'Clock Out'}
                </label>
              ))}
            </div>
          </div>

          {/* Date & time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Date</label>
              <input type="date" className="input" value={dateStr} onChange={e => setDateStr(e.target.value)} />
            </div>
            <div>
              <label className="label">Time</label>
              <input type="time" step="1" className="input" value={timeStr} onChange={e => setTimeStr(e.target.value)} />
            </div>
          </div>

          <div><label className="label">Reason for correction</label><textarea className="input" required minLength={3} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Explain why this entry needs changing" /></div>
          {/* Auto-closed flag */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={isAuto} onChange={e => setIsAuto(e.target.checked)} className="accent-indigo-500" />
            <span className="text-sm text-slate-300">Mark as auto-closed (9 PM scheduler)</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SessionTimeCell({ log, kind, isAdmin, onEdit, onDelete }) {
  const label = kind === 'in' ? 'clock-in' : 'clock-out'
  return (
    <td className="px-4 py-3 text-sm">
      {log ? <div className="flex items-center gap-2">
        <div>
          <p className="text-slate-400 font-mono whitespace-nowrap">{formatTime(log.timestamp)}</p>
          {log.is_auto_closed && <p className="text-xs text-slate-500">Auto-closed</p>}
        </div>
        {isAdmin && <div className="flex items-center gap-1">
          <button onClick={() => onEdit(log)} title={`Edit ${label}`} aria-label={`Edit ${label} for ${log.officer_name ?? log.card_uid}`}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-slate-200">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(log)} title={`Delete ${label}`} aria-label={`Delete ${label} for ${log.officer_name ?? log.card_uid}`}
            className="p-1.5 hover:bg-red-500/15 rounded-lg transition-colors text-slate-400 hover:text-red-400">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>}
      </div> : <span className="text-slate-500">Not recorded</span>}
    </td>
  )
}

// ── Log History Page ──────────────────────────────────────────────────────────
export default function LogHistory() {
  const { isAdmin }            = useAuth()
  const { semesters, activeSemester, loading: semesterLoading, error: semesterError } = useSemester()
  const todayStr               = dateKey()

  const [search,           setSearch]           = useState('')
  const [logs,             setLogs]             = useState([])
  const [context, setContext] = useState(null)
  const [loadedScope, setLoadedScope] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [modal, setModal] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const generation = useRef(0)
  const fetched = Boolean(loadedScope)
  const officerMap = context?.officerMap ?? {}
  const officers = (context?.officers ?? []).filter(o=>o.active !== false)
  const fetchRange = async (from, to, semesterId = '') => {
    if (!from || !to || from > to) return toast.error('Choose a valid date range.')
    const semester = semesters.find(s => s.id === semesterId)
    if (semesterId && (!semester || from < semester.start_date || (semester.end_date && to > semester.end_date))) return toast.error('Choose dates within the selected semester.')
    const current = ++generation.current
    setLoading(true); setError('')
    try {
      await recoverAttendance()
      const [rows, ctx] = await Promise.all([
        listRecords('attendance_logs', { ...dateBounds(from,to), orderBy:'timestamp' }),
        fetchAttendanceContext(semesterId),
      ])
      if (current !== generation.current) return
      setLogs(rows); setContext(ctx); setLoadedScope({from,to,semesterId})
    } catch (e) { if (current === generation.current) setError('Could not load attendance: ' + e.message) }
    finally { if (current === generation.current) setLoading(false) }
  }
  const filters = useHistoryFilters({ semesters, activeSemester, loading: semesterLoading, error: semesterError, load: fetchRange, today: todayStr })
  const { from: dateFrom, to: dateTo, semesterId: selectedSemester } = filters
  const selectedTerm = semesters.find(s => s.id === selectedSemester)
  const fetchLogs = () => fetchRange(dateFrom,dateTo,selectedSemester)
  useEffect(() => () => { generation.current++ }, [])
  const applyPreset = days => {
    if (!filters.applyPreset(days)) toast.error('That date range falls outside the selected semester.')
  }
  const stale = !loadedScope || loadedScope.from !== dateFrom || loadedScope.to !== dateTo || loadedScope.semesterId !== selectedSemester
  const exportReady = !semesterLoading && !semesterError && !loading && !error && !stale
  const handleDelete = async (log) => {
    const reason = window.prompt('Why should this attendance entry be deleted? (At least 3 characters)')
    if (reason == null) return
    if (reason.trim().length < 3) return toast.error('A deletion reason is required.')
    try {
      await deleteRecord('attendance_logs', log.id, reason)
      setLogs(prev => prev.filter(l => l.id !== log.id))
      toast.success('Entry deleted.')
    } catch (err) {
      toast.error('Delete failed: ' + err.message)
    }
  }

  const sessions = buildAttendanceSessions(logs.map(log=>({...log,nfc_uid:nfcUid(officerMap[log.card_uid],log.card_uid)})))
  const filteredSessions = filterAttendanceSessions(sessions, search)
  const filtered = filteredSessions.flatMap(s => [s.clockIn,s.clockOut].filter(Boolean))
  const reportOptions = () => ({logs,dateFrom:loadedScope.from,dateTo:loadedScope.to,context,
    officerMap,search,selectedSemester:loadedScope.semesterId,semesters:context.semesters})
  const handleExportXLSX = () => {
    if (!exportReady) return
    setExporting(true)
    try { const result = exportXLSXReport(reportOptions()); toast.success(`Downloaded ${result.filename}`) }
    catch (e) { toast.error(e.message) } finally { setExporting(false) }
  }
  const handleExportCSV = () => {
    if (!exportReady) return
    try { const count = exportCSVReport({...reportOptions(),label:`${loadedScope.from}_to_${loadedScope.to}`}); toast.success(`Exported ${count} records.`) }
    catch (e) { toast.error(e.message) }
  }
  const activeSemObj = context?.semesters.find(s => s.id === loadedScope?.semesterId)
  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <History className="w-6 h-6 text-brand-400" />
            Log History
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            Browse, filter by semester or custom date range, and export reports.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <button id="import-csv-btn" onClick={() => setImportOpen(true)} className="btn-secondary" disabled={semesterLoading || !!semesterError}>
              <Upload className="w-4 h-4" /> Import CSV
            </button>
          )}
          {isAdmin && (
            <button id="add-log-btn" onClick={() => setModal('add')} className="btn-secondary">
              <Plus className="w-4 h-4" /> Add Entry
            </button>
          )}
          <button
            id="export-xlsx-btn"
            onClick={handleExportXLSX}
            disabled={!exportReady || exporting}
            className="btn-success"
            title="Download multi-sheet Excel report (.xlsx)"
          >
            {exporting ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4" />
            )}
            {exporting ? 'Generating…' : 'Export Report (.xlsx)'}
          </button>
          <button
            id="export-csv-btn"
            onClick={handleExportCSV}
            disabled={!exportReady}
            className="btn-secondary"
            title="Download session-grouped CSV"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      {/* Filters Card */}
      <div className="card p-5 space-y-4">
        {/* Row 1: Semester Selector + Quick Presets */}
        <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b border-white/8">
          {/* Semester Selector */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-500/15 border border-brand-500/30 flex items-center justify-center flex-shrink-0">
              <GraduationCap className="w-4 h-4 text-brand-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Semester Filter</p>
              <Select
                id="semester-filter-select"
                aria-label="History semester"
                className="input py-1 px-2.5 text-xs w-auto min-w-48 mt-0.5 bg-slate-900 border-white/15 focus:ring-brand-500"
                value={selectedSemester}
                disabled={semesterLoading || !!semesterError}
                onChange={e => filters.chooseSemester(e.target.value)}
              >
                <option value="">{semesterLoading ? 'Loading semesters...' : 'All semesters'}</option>
                {semesters.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.status === 'active' ? '(Current Active Term)' : '(Past / Archived)'}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* Quick presets */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Quick Range</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {PRESETS.map(({ label, days }) => (
                <button key={label} id={`preset-${label.replace(/\s+/g,'-').toLowerCase()}`}
                  onClick={() => applyPreset(days)}
                  className="px-2.5 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-slate-300 transition-colors">
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2: Date From, Date To, Search, Fetch */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">From Date</label>
            <input id="date-from" type="date" className="input w-40" value={dateFrom} min={selectedTerm?.start_date} max={dateTo}
              onChange={e => filters.setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To Date</label>
            <input id="date-to" type="date" className="input w-40" value={dateTo} min={dateFrom} max={selectedTerm?.end_date || undefined}
              onChange={e => filters.setTo(e.target.value)} />
          </div>
          <div className="flex-1 min-w-40">
            <label className="label">Search Officer / UID</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input id="log-search" className="input pl-8" placeholder="Filter by name, UID, or action…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <button id="fetch-logs-btn" onClick={fetchLogs} disabled={loading || semesterLoading || !!semesterError} className="btn-primary h-9">
            {loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {loading ? 'Loading…' : 'Fetch Logs'}
          </button>
        </div>
      </div>

      {error && <div role="alert" className="card p-4 text-red-300">{error}<button className="btn-secondary ml-3" onClick={fetchLogs}>Retry</button></div>}
      {stale && fetched && <p className="text-amber-300 text-sm">Filters changed. Click Fetch Logs to load this range before exporting.</p>}
      {loadedScope && <p className="text-slate-400 text-xs">Showing {loadedScope.from} to {loadedScope.to} (Asia/Manila). Reports include assigned officers with no taps. Today's absences finalize at 9 PM.</p>}
      {/* Table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-white text-sm">Attendance Records</h2>
            {activeSemObj && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-500/15 text-brand-300 border border-brand-500/25">
                {activeSemObj.name}
              </span>
            )}
          </div>
          <span className="text-xs text-slate-500">{filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''} found</span>
        </div>

        {!fetched ? (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm">Select a date range or semester and click Fetch.</div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mr-3" />Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
            <History className="w-10 h-10 opacity-20" />
            <p className="text-sm">No records found for this date range or semester.</p>
          </div>
        ) : (
          <div className="table-wrapper rounded-none border-0">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Officer</th>
                  <th>Assignment</th>
                  <th>Date</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                  <th>Duration</th>
                  <th>Card UID</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map(session => {
                  const logDateStr = session.date
                  const ts = new Date(`${logDateStr}T12:00:00`)
                  const edited = session.clockIn?.manually_edited || session.clockOut?.manually_edited
                  const dayCfg = resolveDay(logDateStr, context)
                  const isAssigned = (dayCfg?.required_uids ?? []).includes(session.card_uid)
                  const officer = officerMap[session.card_uid]

                  return (
                    <tr key={session.clockIn?.id ?? session.clockOut.id} className={`border-b border-white/5 hover:bg-white/3 transition-colors ${edited ? 'bg-amber-500/5' : ''}`}>
                      <td className="px-4 py-3 font-medium">
                        <p className="text-slate-100">{session.officer_name ?? session.card_uid}</p>
                        {officer?.position && <p className="text-xs text-slate-500">{officer.position}</p>}
                        {edited && <span className="text-xs text-amber-500/70">(edited)</span>}
                      </td>
                      <td className="px-4 py-3">
                        {isAssigned ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-500/20 text-brand-300 border border-brand-500/30">
                            Assigned OOTD
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700/50 text-slate-400 border border-white/10">
                            Not Required
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-sm whitespace-nowrap">{format(ts, 'MMM d, yyyy')}</td>
                      <SessionTimeCell log={session.clockIn} kind="in" isAdmin={isAdmin} onEdit={setModal} onDelete={handleDelete} />
                      <SessionTimeCell log={session.clockOut} kind="out" isAdmin={isAdmin} onEdit={setModal} onDelete={handleDelete} />
                      <td className="px-4 py-3 text-slate-400 text-sm font-mono">{formatDuration(session.clockIn?.timestamp, session.clockOut?.timestamp)}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs font-mono">{nfcUid(officer,session.card_uid) || 'No card linked'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isAdmin && importOpen && <AttendanceImportModal semesters={semesters} initialSemesterId={selectedSemester || activeSemester?.id || ''}
        loadOfficers={loadImportOfficers} loadExisting={loadImportExisting} importRows={importAttendanceCSV}
        onClose={() => setImportOpen(false)} onImported={fetchLogs} />}
      {/* Admin log edit/add modal */}
      {modal && (
        <LogEditModal
          log={modal === 'add' ? null : modal}
          officers={modal !== 'add' && !officers.some(o => o.card_uid === modal.card_uid) ? [...officers,{card_uid:modal.card_uid,first_name:modal.officer_name,last_name:'(historical)'}] : officers}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); fetchLogs() }}
        />
      )}
    </div>
  )
}
