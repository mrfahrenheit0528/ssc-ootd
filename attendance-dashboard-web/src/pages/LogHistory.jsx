// pages/LogHistory.jsx
// --------------------
// Filterable attendance log with date-range picker and CSV export.

import { useState, useEffect, useCallback } from 'react'
import {
  collection, query, where, orderBy, getDocs, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { format, startOfDay, endOfDay, subDays } from 'date-fns'
import toast from 'react-hot-toast'
import { History, Search, Download, LogIn, LogOut, RefreshCw } from 'lucide-react'

// ── CSV export helper ─────────────────────────────────────────────────────────
function exportCSV(logs, dateLabel) {
  const header = ['Date', 'Time', 'Officer', 'Card UID', 'Action', 'Auto-Closed']
  const rows = logs.map(l => {
    const ts = l.timestamp?.toDate?.() ?? new Date(l.timestamp)
    return [
      format(ts, 'yyyy-MM-dd'),
      format(ts, 'HH:mm:ss'),
      l.officer_name ?? l.card_uid,
      l.card_uid,
      l.type,
      l.is_auto_closed ? 'Yes' : 'No',
    ]
  })
  const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `attendance_${dateLabel}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Quick date presets ────────────────────────────────────────────────────────
const PRESETS = [
  { label: 'Today',      days: 0 },
  { label: 'Yesterday',  days: 1 },
  { label: 'Last 7 days',days: 7 },
  { label: 'Last 30 days', days: 30 },
]

function TypePill({ type, isAuto }) {
  return type === 'CLOCK_IN' ? (
    <span className="badge-clock-in">
      <LogIn className="w-3 h-3" /> Clock In
    </span>
  ) : (
    <span className="badge-clock-out">
      <LogOut className="w-3 h-3" /> Clock Out{isAuto && <span className="opacity-60 ml-1">(auto)</span>}
    </span>
  )
}

export default function LogHistory() {
  const todayStr = format(new Date(), 'yyyy-MM-dd')

  const [dateFrom, setDateFrom] = useState(todayStr)
  const [dateTo,   setDateTo]   = useState(todayStr)
  const [search,   setSearch]   = useState('')
  const [logs,     setLogs]     = useState([])
  const [loading,  setLoading]  = useState(false)
  const [fetched,  setFetched]  = useState(false)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const from = Timestamp.fromDate(startOfDay(new Date(dateFrom + 'T00:00:00')))
      const to   = Timestamp.fromDate(endOfDay(new Date(dateTo   + 'T00:00:00')))

      const q = query(
        collection(db, 'attendance_logs'),
        where('timestamp', '>=', from),
        where('timestamp', '<=', to),
        orderBy('timestamp', 'desc'),
      )
      const snap = await getDocs(q)
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setFetched(true)
    } catch (err) {
      toast.error('Failed to load logs: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  // Auto-fetch on mount (today)
  useEffect(() => { fetchLogs() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const applyPreset = (days) => {
    const from = days === 0 ? todayStr : format(subDays(new Date(), days), 'yyyy-MM-dd')
    const to   = todayStr
    setDateFrom(from)
    setDateTo(to)
  }

  const filtered = logs.filter(l => {
    const q = search.toLowerCase()
    return !q
      || l.officer_name?.toLowerCase().includes(q)
      || l.card_uid?.toLowerCase().includes(q)
      || l.type?.toLowerCase().includes(q)
  })

  const handleExport = () => {
    if (filtered.length === 0) return toast.error('No data to export.')
    const label = dateFrom === dateTo ? dateFrom : `${dateFrom}_to_${dateTo}`
    exportCSV(filtered, label)
    toast.success(`Exported ${filtered.length} rows as CSV.`)
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <History className="w-6 h-6 text-brand-400" />
            Log History
          </h1>
          <p className="text-slate-400 mt-1 text-sm">Browse and export historical attendance records.</p>
        </div>
        <button
          id="export-csv-btn"
          onClick={handleExport}
          disabled={filtered.length === 0}
          className="btn-success"
        >
          <Download className="w-4 h-4" />
          Export CSV ({filtered.length})
        </button>
      </div>

      {/* Filters */}
      <div className="card p-5 space-y-4">
        {/* Quick presets */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 font-medium uppercase tracking-wide mr-1">Quick:</span>
          {PRESETS.map(({ label, days }) => (
            <button
              key={label}
              id={`preset-${label.replace(/\s+/g,'-').toLowerCase()}`}
              onClick={() => applyPreset(days)}
              className="px-3 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-white/10 border border-white/10
                         hover:border-white/20 text-slate-300 transition-colors duration-150"
            >
              {label}
            </button>
          ))}
        </div>

        {/* Date range + search */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">From</label>
            <input id="date-from" type="date" className="input w-40"
              value={dateFrom} max={dateTo}
              onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input id="date-to" type="date" className="input w-40"
              value={dateTo} min={dateFrom} max={todayStr}
              onChange={e => setDateTo(e.target.value)} />
          </div>
          <div className="flex-1 min-w-40">
            <label className="label">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input id="log-search" className="input pl-8" placeholder="Name, UID, or action…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <button id="fetch-logs-btn" onClick={fetchLogs} disabled={loading} className="btn-primary h-9">
            {loading
              ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <RefreshCw className="w-4 h-4" />
            }
            {loading ? 'Loading…' : 'Fetch'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-semibold text-white text-sm">Results</h2>
          <span className="text-xs text-slate-500">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {!fetched ? (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm">
            Select a date range and click Fetch.
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mr-3" />
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
            <History className="w-10 h-10 opacity-20" />
            <p className="text-sm">No records found for this range.</p>
          </div>
        ) : (
          <div className="table-wrapper rounded-none border-0">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Officer</th>
                  <th>Action</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Card UID</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(log => {
                  const ts = log.timestamp?.toDate?.() ?? new Date(log.timestamp)
                  return (
                    <tr key={log.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                      <td className="px-4 py-3 font-medium">{log.officer_name ?? log.card_uid}</td>
                      <td className="px-4 py-3">
                        <TypePill type={log.type} isAuto={log.is_auto_closed} />
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-sm">{format(ts, 'MMM d, yyyy')}</td>
                      <td className="px-4 py-3 text-slate-400 text-sm font-mono">{format(ts, 'hh:mm:ss a')}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs font-mono">{log.card_uid}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
