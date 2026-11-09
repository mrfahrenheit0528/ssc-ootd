// pages/LogHistory.jsx
// --------------------
// Attendance sessions with paired clock-in/out times, date filters, search, and exports.
// Admins also get: edit entry, delete entry, add manual entry.

import { useState, useEffect, useCallback } from 'react'
import { listRecords, updateRecord, deleteRecord, addRecord, Instant } from '../data'
import { useAuth } from '../contexts/AuthContext'
import { useSemester } from '../contexts/SemesterContext'
import { format, startOfDay, endOfDay, subDays } from 'date-fns'
import toast from 'react-hot-toast'
import {
  History, Search, Download, LogIn, LogOut, RefreshCw,
  Plus, Pencil, Trash2, X, Save, GraduationCap, FileSpreadsheet,
} from 'lucide-react'
import {
  resolveDay, fetchAttendanceContext, formatTime, formatDuration,
  exportXLSXReport, exportCSVReport,
} from '../utils/reportExport'
import { buildAttendanceSessions, filterAttendanceSessions } from '../utils/attendanceSessions'

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
    log?.timestamp?.toDate ? format(log.timestamp.toDate(), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')
  )
  const [timeStr, setTimeStr] = useState(
    log?.timestamp?.toDate ? format(log.timestamp.toDate(), 'HH:mm') : format(new Date(), 'HH:mm')
  )
  const [isAuto, setIsAuto]   = useState(log?.is_auto_closed ?? false)
  const [saving, setSaving]   = useState(false)

  const selectedOfficer = officers.find(o => o.card_uid === officerUid)

  const handleSave = async () => {
    if (!officerUid.trim()) return toast.error('Officer is required.')
    setSaving(true)
    try {
      const ts = new Date(`${dateStr}T${timeStr}:00`)
      const payload = {
        card_uid:        officerUid.toUpperCase().trim(),
        officer_name:    selectedOfficer ? `${selectedOfficer.first_name} ${selectedOfficer.last_name}` : officerUid,
        type,
        timestamp:       Instant.fromDate(ts),
        is_auto_closed:  isAuto,
        manually_edited: true,
      }
      if (isAdd) {
        await addRecord('attendance_logs', payload)
        toast.success('Log entry added.')
      } else {
        await updateRecord('attendance_logs', log.id, payload)
        toast.success('Log entry updated.')
      }
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
              <select className="input" value={officerUid} onChange={e => setOfficerUid(e.target.value)}>
                <option value="">— Select officer —</option>
                {officers.map(o => (
                  <option key={o.card_uid} value={o.card_uid}>
                    {o.first_name} {o.last_name} ({o.card_uid})
                  </option>
                ))}
              </select>
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
              <input type="time" className="input" value={timeStr} onChange={e => setTimeStr(e.target.value)} />
            </div>
          </div>

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
  const { semesters }          = useSemester()
  const todayStr               = format(new Date(), 'yyyy-MM-dd')

  const [dateFrom,         setDateFrom]         = useState(todayStr)
  const [dateTo,           setDateTo]           = useState(todayStr)
  const [selectedSemester, setSelectedSemester] = useState('')
  const [search,           setSearch]           = useState('')
  const [logs,             setLogs]             = useState([])
  const [officers,         setOfficers]         = useState([])
  const [officerMap,       setOfficerMap]       = useState({})
  const [dayConfigMap,     setDayConfigMap]     = useState({})
  const [weeklySchedule,   setWeeklySchedule]   = useState(null)
  const [weeklyEffFrom,    setWeeklyEffFrom]    = useState(null)
  const [loading,          setLoading]          = useState(false)
  const [exporting,        setExporting]        = useState(false)
  const [fetched,          setFetched]          = useState(false)
  const [modal,            setModal]            = useState(null) // null | 'add' | log obj

  // Load day config and officers context for assignment resolution
  useEffect(() => {
    fetchAttendanceContext(selectedSemester, semesters)
      .then(ctx => {
        setDayConfigMap(ctx.dayConfigMap)
        setWeeklySchedule(ctx.weeklySchedule)
        setWeeklyEffFrom(ctx.weeklyEffectiveFrom)
        setOfficers(ctx.officers)
        setOfficerMap(ctx.officerMap)
      })
      .catch(err => console.error('Failed to load attendance context:', err))
  }, [selectedSemester, semesters])

  const fetchRange = useCallback(async (fromStr, toStr) => {
    setLoading(true)
    try {
      const from = Instant.fromDate(startOfDay(new Date(fromStr + 'T00:00:00')))
      const to   = Instant.fromDate(endOfDay(new Date(toStr   + 'T00:00:00')))
      const rows = await listRecords('attendance_logs', { from: from.toDate(), to: to.toDate(), orderBy: 'timestamp' })
      setLogs(rows)
      setFetched(true)
    } catch (err) {
      toast.error('Failed to load logs: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchLogs = () => fetchRange(dateFrom, dateTo)

  useEffect(() => { fetchLogs() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const applyPreset = (days) => {
    setSelectedSemester('')
    const from = days === 0 ? todayStr : format(subDays(new Date(), days), 'yyyy-MM-dd')
    setDateFrom(from)
    setDateTo(todayStr)
    fetchRange(from, todayStr)
  }

  const handleSemesterChange = (semId) => {
    setSelectedSemester(semId)
    if (!semId) return
    const sem = semesters.find(s => s.id === semId)
    if (sem) {
      const from = sem.start_date
      const to   = sem.end_date || todayStr
      setDateFrom(from)
      setDateTo(to)
      fetchRange(from, to)
      toast.success(`Loaded logs for "${sem.name}"`)
    }
  }

  const handleDelete = async (log) => {
    if (!window.confirm(`Delete this ${log.type === 'CLOCK_IN' ? 'clock-in' : 'clock-out'} entry?`)) return
    try {
      await deleteRecord('attendance_logs', log.id)
      setLogs(prev => prev.filter(l => l.id !== log.id))
      toast.success('Entry deleted.')
    } catch (err) {
      toast.error('Delete failed: ' + err.message)
    }
  }

  const sessions = buildAttendanceSessions(logs)
  const filteredSessions = filterAttendanceSessions(sessions, search)
  // Search whole sessions before selecting raw events so exports retain pairs.
  const filtered = filteredSessions.flatMap(session => [session.clockIn, session.clockOut].filter(Boolean))

  // Export multi-sheet XLSX report with assigned vs voluntary distinction
  const handleExportXLSX = async () => {
    if (filtered.length === 0) return toast.error('No data to export.')
    setExporting(true)
    try {
      const res = exportXLSXReport({
        logs: filtered,
        dateFrom,
        dateTo,
        selectedSemester,
        semesters,
        officerMap,
        dayConfigMap,
        weeklySchedule,
        weeklyEffectiveFrom: weeklyEffFrom,
      })
      toast.success(`Downloaded ${res.filename} with ${res.sheetsCount} sheets.`)
    } catch (err) {
      console.error('XLSX export error:', err)
      toast.error('Export failed: ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  // Export CSV with assignment distinction
  const handleExportCSV = () => {
    if (filtered.length === 0) return toast.error('No data to export.')
    const sem = semesters.find(s => s.id === selectedSemester)
    const label = sem
      ? sem.name.replace(/\s+/g, '_').toLowerCase()
      : (dateFrom === dateTo ? dateFrom : `${dateFrom}_to_${dateTo}`)
    const count = exportCSVReport({
      logs: filtered,
      label,
      officerMap,
      dayConfigMap,
      weeklySchedule,
      weeklyEffectiveFrom: weeklyEffFrom,
    })
    toast.success(`Exported ${count} records to CSV.`)
  }

  const activeSemObj = semesters.find(s => s.id === selectedSemester)

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
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button id="add-log-btn" onClick={() => setModal('add')} className="btn-secondary">
              <Plus className="w-4 h-4" /> Add Entry
            </button>
          )}
          <button
            id="export-xlsx-btn"
            onClick={handleExportXLSX}
            disabled={filtered.length === 0 || exporting}
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
            disabled={filtered.length === 0}
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
              <select
                id="semester-filter-select"
                className="input py-1 px-2.5 text-xs w-auto min-w-48 mt-0.5 bg-slate-900 border-white/15 focus:ring-brand-500"
                value={selectedSemester}
                onChange={e => handleSemesterChange(e.target.value)}
              >
                <option value="">— Choose a Semester —</option>
                {semesters.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.status === 'active' ? '(Current Active Term)' : '(Past / Archived)'}
                  </option>
                ))}
              </select>
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
            <input id="date-from" type="date" className="input w-40" value={dateFrom} max={dateTo}
              onChange={e => { setDateFrom(e.target.value); setSelectedSemester('') }} />
          </div>
          <div>
            <label className="label">To Date</label>
            <input id="date-to" type="date" className="input w-40" value={dateTo} min={dateFrom}
              onChange={e => { setDateTo(e.target.value); setSelectedSemester('') }} />
          </div>
          <div className="flex-1 min-w-40">
            <label className="label">Search Officer / UID</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input id="log-search" className="input pl-8" placeholder="Filter by name, UID, or action…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <button id="fetch-logs-btn" onClick={fetchLogs} disabled={loading} className="btn-primary h-9">
            {loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {loading ? 'Loading…' : 'Fetch Logs'}
          </button>
        </div>
      </div>

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
                  const dayCfg = resolveDay(logDateStr, dayConfigMap, weeklySchedule, weeklyEffFrom)
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
                      <td className="px-4 py-3 text-slate-500 text-xs font-mono">{session.card_uid}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Admin log edit/add modal */}
      {modal && (
        <LogEditModal
          log={modal === 'add' ? null : modal}
          officers={officers}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); fetchLogs() }}
        />
      )}
    </div>
  )
}
