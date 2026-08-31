// pages/LiveKiosk.jsx
// -------------------
// Real-time attendance board for today's events.
// Uses Firestore onSnapshot to receive live updates the moment a tag is tapped.

import { useState, useEffect, useRef } from 'react'
import { collection, query, where, orderBy, onSnapshot, Timestamp } from 'firebase/firestore'
import { format, startOfDay, endOfDay } from 'date-fns'
import { db } from '../firebase'
import { useSemester } from '../contexts/SemesterContext'
import { Monitor, LogIn, LogOut, Clock, Users, Wifi, WifiOff, GraduationCap } from 'lucide-react'

function StatusPill({ type, isAuto }) {
  return type === 'CLOCK_IN' ? (
    <span className="badge-clock-in">
      <LogIn className="w-3 h-3" />
      Clock In
    </span>
  ) : (
    <span className="badge-clock-out">
      <LogOut className="w-3 h-3" />
      Clock Out{isAuto && <span className="opacity-60 ml-1">(auto)</span>}
    </span>
  )
}

function StatCard({ icon: Icon, label, value, accent }) {
  const accents = {
    brand:   'from-brand-500/20 to-brand-600/10 border-brand-500/30 text-brand-300',
    emerald: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 text-emerald-300',
    amber:   'from-amber-500/20 to-amber-600/10 border-amber-500/30 text-amber-300',
  }
  return (
    <div className={`card bg-gradient-to-br ${accents[accent]} p-5 flex items-center gap-4`}>
      <div className="p-3 bg-white/10 rounded-xl">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-white mt-0.5">{value}</p>
      </div>
    </div>
  )
}

function LogRow({ log, isNew }) {
  return (
    <tr className={`border-b border-white/5 transition-all duration-500 ${isNew ? 'bg-brand-500/10 animate-fade-in' : 'hover:bg-white/3'}`}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500/30 to-violet-500/30 border border-white/10 flex items-center justify-center text-xs font-bold text-brand-300">
            {log.officer_name?.charAt(0) ?? '?'}
          </div>
          <span className="font-medium text-slate-100">{log.officer_name ?? log.card_uid}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusPill type={log.type} isAuto={log.is_auto_closed} />
      </td>
      <td className="px-4 py-3 text-slate-400 text-sm font-mono">
        {log.timestamp?.toDate
          ? format(log.timestamp.toDate(), 'hh:mm:ss a')
          : '—'}
      </td>
      <td className="px-4 py-3 text-slate-500 text-xs font-mono">
        {log.card_uid}
      </td>
    </tr>
  )
}

export default function LiveKiosk() {
  const { activeSemester }        = useSemester()
  const [logs, setLogs]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [connected, setConnected] = useState(true)
  const [newIds, setNewIds]       = useState(new Set())
  const prevIds = useRef(new Set())

  const today = new Date()
  const todayStart = Timestamp.fromDate(startOfDay(today))
  const todayEnd   = Timestamp.fromDate(endOfDay(today))

  useEffect(() => {
    const q = query(
      collection(db, 'attendance_logs'),
      where('timestamp', '>=', todayStart),
      where('timestamp', '<=', todayEnd),
      orderBy('timestamp', 'desc'),
    )

    const unsub = onSnapshot(
      q,
      (snap) => {
        const incoming = snap.docs.map(d => ({ id: d.id, ...d.data() }))

        // Detect newly added docs
        const freshIds = new Set()
        incoming.forEach(doc => {
          if (!prevIds.current.has(doc.id)) freshIds.add(doc.id)
        })
        prevIds.current = new Set(incoming.map(d => d.id))

        if (freshIds.size > 0) {
          setNewIds(freshIds)
          setTimeout(() => setNewIds(new Set()), 2500) // remove highlight after 2.5s
        }

        setLogs(incoming)
        setLoading(false)
        setConnected(true)
      },
      (err) => {
        console.error('Firestore snapshot error:', err)
        setConnected(false)
        setLoading(false)
      },
    )

    return () => unsub()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const totalToday  = logs.length
  const clockIns    = logs.filter(l => l.type === 'CLOCK_IN').length
  const clockOuts   = logs.filter(l => l.type === 'CLOCK_OUT').length
  const onDutyNow   = clockIns - clockOuts

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Monitor className="w-6 h-6 text-brand-400" />
            Live Kiosk
          </h1>
          <p className="text-slate-400 mt-1 text-sm flex items-center gap-2 flex-wrap">
            <span>{format(today, 'EEEE, MMMM d, yyyy')}</span>
            {activeSemester && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-500/15 text-brand-300 border border-brand-500/25">
                <GraduationCap className="w-3 h-3" />
                {activeSemester.name}
              </span>
            )}
          </p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
          connected
            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
            : 'bg-red-500/10 border-red-500/25 text-red-400'
        }`}>
          {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {connected ? (
            <><span className="live-dot" />Live</>
          ) : 'Disconnected'}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Clock}  label="Total Events"   value={totalToday} accent="brand"   />
        <StatCard icon={Users}  label="Currently On Duty" value={Math.max(0, onDutyNow)} accent="emerald" />
        <StatCard icon={LogOut} label="Clocked Out"    value={clockOuts}  accent="amber"  />
      </div>

      {/* Log table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-semibold text-white text-sm">Today's Attendance Events</h2>
          <span className="text-xs text-slate-500">{totalToday} event{totalToday !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mr-3" />
            Loading…
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-3">
            <Clock className="w-10 h-10 opacity-30" />
            <p className="text-sm">No attendance events yet today.</p>
            <p className="text-xs opacity-60">Tap an NFC card on the reader to get started.</p>
          </div>
        ) : (
          <div className="table-wrapper rounded-none border-0">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Officer</th>
                  <th>Action</th>
                  <th>Time</th>
                  <th>Card UID</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <LogRow key={log.id} log={log} isNew={newIds.has(log.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
