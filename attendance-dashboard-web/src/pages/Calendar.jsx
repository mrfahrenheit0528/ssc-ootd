// pages/Calendar.jsx
// ------------------
// Monthly attendance calendar. Public (read-only for all users).
// Queries attendance_logs + day_config + officers for the selected month.
// Shows per-day status, attendance ratio, and a slide-in day detail drawer.

import { useState, useEffect, useCallback } from 'react'
import {
  collection, query, where, getDocs, doc, getDoc, Timestamp,
} from 'firebase/firestore'
import {
  startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, format, isSameDay, isToday, isBefore, startOfDay,
  addMonths, subMonths,
} from 'date-fns'
import { db } from '../firebase'
import { CalendarDays, ChevronLeft, ChevronRight, X, Clock, UserCircle } from 'lucide-react'

// ── Day type config ──────────────────────────────────────────────────────────
const DAY_TYPES = {
  regular:    { label: 'Regular',    color: 'text-slate-400', bg: '' },
  holiday:    { label: 'Holiday',    color: 'text-sky-400',   bg: 'bg-sky-500/10 border-sky-500/20' },
  no_classes: { label: 'No Classes', color: 'text-violet-400',bg: 'bg-violet-500/10 border-violet-500/20' },
  optional:   { label: 'Optional',   color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
}

const STATUS_CONFIG = {
  full:    { emoji: '✅', label: 'Full',     chipClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
  partial: { emoji: '⚠️', label: 'Partial',  chipClass: 'bg-amber-500/15  text-amber-400  border-amber-500/20'  },
  absent:  { emoji: '❌', label: 'No Data',  chipClass: 'bg-red-500/15    text-red-400    border-red-500/20'    },
  holiday: { emoji: '🎉', label: 'Holiday',  chipClass: 'bg-sky-500/15    text-sky-400    border-sky-500/20'    },
  no_classes: { emoji: '📚', label: 'No Classes', chipClass: 'bg-violet-500/15 text-violet-400 border-violet-500/20' },
  optional:   { emoji: '🔵', label: 'Optional',   chipClass: 'bg-amber-500/15  text-amber-400  border-amber-500/20'  },
  future:  { emoji: '',   label: '',        chipClass: '' },
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getDayStatus(dayDate, dayConfig, logs, requiredUids, defaultRequired) {
  const ds = format(dayDate, 'yyyy-MM-dd')
  const cfg = dayConfig[ds]
  const type = cfg?.type ?? 'regular'

  if (type === 'holiday')    return 'holiday'
  if (type === 'no_classes') return 'no_classes'
  if (type === 'optional')   return 'optional'

  if (isBefore(dayDate, startOfDay(new Date())) && !isToday(dayDate)) {
    // Past day — show attendance ratio
    const dayLogs   = logs.filter(l =>
      l.type === 'CLOCK_IN' && l.timestamp?.toDate && isSameDay(l.timestamp.toDate(), dayDate)
    )
    const attended  = new Set(dayLogs.map(l => l.card_uid)).size
    const required  = (cfg?.required_uids ?? defaultRequired).length
    if (required === 0)    return attended > 0 ? 'full' : 'absent'
    if (attended >= required) return 'full'
    if (attended > 0)      return 'partial'
    return 'absent'
  }

  if (isToday(dayDate)) {
    const todayLogs = logs.filter(l =>
      l.type === 'CLOCK_IN' && l.timestamp?.toDate && isSameDay(l.timestamp.toDate(), dayDate)
    )
    const attended  = new Set(todayLogs.map(l => l.card_uid)).size
    const required  = (cfg?.required_uids ?? defaultRequired).length
    if (required === 0)    return attended > 0 ? 'full' : 'absent'
    if (attended >= required) return 'full'
    if (attended > 0)      return 'partial'
    return 'absent'
  }

  return 'future'
}

function getAttendanceRatio(dayDate, dayConfig, logs, defaultRequired) {
  const ds  = format(dayDate, 'yyyy-MM-dd')
  const cfg = dayConfig[ds]
  const dayLogs  = logs.filter(l =>
    l.type === 'CLOCK_IN' && l.timestamp?.toDate && isSameDay(l.timestamp.toDate(), dayDate)
  )
  const attended = new Set(dayLogs.map(l => l.card_uid)).size
  const required = (cfg?.required_uids ?? defaultRequired).length
  return { attended, required }
}

// ── Day Cell ─────────────────────────────────────────────────────────────────
function DayCell({ date, dayConfig, logs, defaultRequired, onClick, isCurrentMonth }) {
  if (!isCurrentMonth) {
    return <div className="min-h-[80px] rounded-xl opacity-20" />
  }

  const status = getDayStatus(date, dayConfig, logs, [], defaultRequired)
  const sc     = STATUS_CONFIG[status]
  const { attended, required } = getAttendanceRatio(date, dayConfig, logs, defaultRequired)
  const ds     = format(date, 'yyyy-MM-dd')
  const cfg    = dayConfig[ds]
  const isPast = isBefore(date, startOfDay(new Date()))
  const today  = isToday(date)

  return (
    <button
      onClick={() => onClick(date)}
      className={`min-h-[80px] rounded-xl p-2.5 text-left border transition-all duration-150 hover:scale-[1.02] hover:shadow-lg
        ${today ? 'border-brand-500/60 bg-brand-500/10 ring-1 ring-brand-500/30' : 'border-white/8 bg-white/3 hover:bg-white/6 hover:border-white/15'}`}
    >
      {/* Date number */}
      <div className="flex items-start justify-between mb-1.5">
        <span className={`text-sm font-semibold ${today ? 'text-brand-300' : 'text-slate-300'}`}>
          {format(date, 'd')}
        </span>
        {sc.emoji && <span className="text-sm leading-none">{sc.emoji}</span>}
      </div>

      {/* Status chip */}
      {status !== 'future' && (
        <div className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-medium border mb-1 ${sc.chipClass}`}>
          {sc.label}
        </div>
      )}

      {/* Attendance count */}
      {(status === 'full' || status === 'partial') && (
        <p className="text-xs text-slate-500 mt-0.5">
          {attended}{required > 0 ? `/${required}` : ''} officers
        </p>
      )}
      {status === 'absent' && isPast && required > 0 && (
        <p className="text-xs text-red-500/70 mt-0.5">0/{required} present</p>
      )}
      {cfg?.note && (
        <p className="text-xs text-slate-500 truncate mt-0.5">{cfg.note}</p>
      )}
    </button>
  )
}

// ── Day Detail Drawer ─────────────────────────────────────────────────────────
function DayDrawer({ date, dayConfig, logs, officers, defaultRequired, onClose }) {
  const ds       = format(date, 'yyyy-MM-dd')
  const cfg      = dayConfig[ds]
  const type     = cfg?.type ?? 'regular'
  const dtConfig = DAY_TYPES[type]

  const dayLogs  = logs.filter(l => l.timestamp?.toDate && isSameDay(l.timestamp.toDate(), date))
  const clockIns = dayLogs.filter(l => l.type === 'CLOCK_IN')
  const attendedUids = new Set(clockIns.map(l => l.card_uid))

  const required  = cfg?.required_uids ?? defaultRequired
  const officerMap = Object.fromEntries(officers.map(o => [o.card_uid, o]))

  // Absent required officers
  const absentRequired = required.filter(uid => !attendedUids.has(uid))

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in" onClick={onClose}>
      <div className="flex-1" />
      <div
        className="w-full max-w-sm bg-slate-900 border-l border-white/10 h-full overflow-y-auto shadow-2xl animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-5 border-b border-white/10 flex items-start justify-between">
          <div>
            <h2 className="font-bold text-white text-lg">{format(date, 'MMMM d, yyyy')}</h2>
            <span className={`text-xs font-medium ${dtConfig.color}`}>{dtConfig.label}</span>
            {cfg?.note && <p className="text-xs text-slate-500 mt-0.5">{cfg.note}</p>}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-3 text-center">
              <p className="text-lg font-bold text-white">{clockIns.length}</p>
              <p className="text-xs text-slate-500">Clock-ins</p>
            </div>
            <div className="card p-3 text-center">
              <p className="text-lg font-bold text-emerald-400">{attendedUids.size}</p>
              <p className="text-xs text-slate-500">Officers</p>
            </div>
            <div className="card p-3 text-center">
              <p className="text-lg font-bold text-red-400">{absentRequired.length}</p>
              <p className="text-xs text-slate-500">Absent</p>
            </div>
          </div>

          {/* Attendance log */}
          {dayLogs.length > 0 ? (
            <div>
              <h3 className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-3">Events</h3>
              <div className="space-y-2">
                {dayLogs
                  .sort((a, b) => (a.timestamp?.toMillis?.() ?? 0) - (b.timestamp?.toMillis?.() ?? 0))
                  .map(log => {
                    const officer = officerMap[log.card_uid]
                    return (
                      <div key={log.id} className="flex items-center gap-3 py-2 border-b border-white/5">
                        {officer?.photo_url
                          ? <img src={officer.photo_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                          : <div className="w-8 h-8 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center flex-shrink-0">
                              <UserCircle className="w-4 h-4 text-brand-400" />
                            </div>
                        }
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-200 font-medium truncate">
                            {log.officer_name ?? officer ? `${officer.first_name} ${officer.last_name}` : log.card_uid}
                          </p>
                          <p className="text-xs text-slate-500 font-mono">{log.card_uid}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className={log.type === 'CLOCK_IN' ? 'badge-clock-in' : 'badge-clock-out'}>
                            {log.type === 'CLOCK_IN' ? 'In' : 'Out'}
                          </span>
                          <p className="text-xs text-slate-600 mt-1 font-mono">
                            {log.timestamp?.toDate ? format(log.timestamp.toDate(), 'h:mm a') : '—'}
                          </p>
                        </div>
                      </div>
                    )
                  })
                }
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center py-8 text-slate-600 gap-2">
              <Clock className="w-8 h-8 opacity-30" />
              <p className="text-sm">No attendance events this day.</p>
            </div>
          )}

          {/* Absent required officers */}
          {absentRequired.length > 0 && (
            <div>
              <h3 className="text-xs text-red-500/70 font-semibold uppercase tracking-wide mb-3">Required — Absent</h3>
              <div className="space-y-2">
                {absentRequired.map(uid => {
                  const o = officerMap[uid]
                  return (
                    <div key={uid} className="flex items-center gap-3 py-2 opacity-60">
                      <div className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                        <UserCircle className="w-4 h-4 text-red-400" />
                      </div>
                      <div>
                        <p className="text-sm text-slate-300">{o ? `${o.first_name} ${o.last_name}` : uid}</p>
                        <p className="text-xs text-slate-600">{o?.position ?? uid}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Calendar Page ─────────────────────────────────────────────────────────────
export default function Calendar() {
  const [month,          setMonth]         = useState(new Date())
  const [logs,           setLogs]          = useState([])
  const [dayConfig,      setDayConfig]     = useState({})
  const [defaultRequired,setDefaultRequired] = useState([])
  const [officers,       setOfficers]      = useState([])
  const [loading,        setLoading]       = useState(false)
  const [selectedDay,    setSelectedDay]   = useState(null)

  const monthStart = startOfMonth(month)
  const monthEnd   = endOfMonth(month)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      // Attendance logs for this month
      const logsQ = query(
        collection(db, 'attendance_logs'),
        where('timestamp', '>=', Timestamp.fromDate(monthStart)),
        where('timestamp', '<=', Timestamp.fromDate(monthEnd)),
      )
      const [logsSnap, officersSnap, defaultsSnap] = await Promise.all([
        getDocs(logsQ),
        getDocs(collection(db, 'officers')),
        getDoc(doc(db, 'day_config', 'defaults')),
      ])

      setLogs(logsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setOfficers(officersSnap.docs.map(d => ({ card_uid: d.id, ...d.data() })))
      setDefaultRequired(defaultsSnap.exists() ? (defaultsSnap.data().required_uids ?? []) : [])

      // Day configs for this month
      const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
      const configMap = {}
      await Promise.all(days.map(async (day) => {
        const ds = format(day, 'yyyy-MM-dd')
        const snap = await getDoc(doc(db, 'day_config', ds))
        if (snap.exists()) configMap[ds] = snap.data()
      }))
      setDayConfig(configMap)
    } catch (err) {
      console.error('Calendar fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [month]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  // Calendar grid: pad to start on Sunday
  const days       = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const startPad   = getDay(monthStart) // 0=Sun
  const paddedDays = [...Array(startPad).fill(null), ...days]
  const WEEKDAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <CalendarDays className="w-6 h-6 text-brand-400" />
            Attendance Calendar
          </h1>
          <p className="text-slate-400 mt-1 text-sm">Monthly overview of officer attendance</p>
        </div>
        {/* Month navigation */}
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(m => subMonths(m, 1))}
            className="btn-secondary p-2"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-semibold text-white w-32 text-center">
            {format(month, 'MMMM yyyy')}
          </span>
          <button onClick={() => setMonth(m => addMonths(m, 1))}
            className="btn-secondary p-2"><ChevronRight className="w-4 h-4" /></button>
          <button onClick={() => setMonth(new Date())} className="btn-secondary text-xs px-3">Today</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(STATUS_CONFIG).filter(([k]) => k !== 'future').map(([, v]) => (
          <span key={v.label} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${v.chipClass}`}>
            {v.emoji} {v.label}
          </span>
        ))}
      </div>

      {/* Grid */}
      <div className="card p-4 overflow-hidden">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-2 mb-2">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wider py-2">
              {d}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mr-3" />
            Loading…
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-2">
            {paddedDays.map((date, i) => (
              date
                ? <DayCell
                    key={format(date, 'yyyy-MM-dd')}
                    date={date}
                    dayConfig={dayConfig}
                    logs={logs}
                    defaultRequired={defaultRequired}
                    isCurrentMonth={true}
                    onClick={setSelectedDay}
                  />
                : <div key={`pad-${i}`} className="min-h-[80px]" />
            ))}
          </div>
        )}
      </div>

      {/* Day detail drawer */}
      {selectedDay && (
        <DayDrawer
          date={selectedDay}
          dayConfig={dayConfig}
          logs={logs}
          officers={officers}
          defaultRequired={defaultRequired}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  )
}
