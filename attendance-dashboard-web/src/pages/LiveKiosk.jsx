// pages/LiveKiosk.jsx
// -------------------
// Real-time attendance board for today's events.
// Uses Supabase Realtime to receive live updates the moment a tag is tapped.

import React, { useState, useEffect, useRef } from 'react'
import { watchLiveAttendance, recoverAttendance } from '../data'
import { format } from 'date-fns'
import { dateKey,formatTime } from '../utils/attendanceTime'
import { buildAttendanceSessions, latestAttendanceByOfficer } from '../utils/attendanceSessions'
import { useSemester } from '../contexts/SemesterContext'
import { nfcUid } from '../utils/officerIdentity'
import { Monitor, LogOut, Clock, Users, Wifi, WifiOff, GraduationCap } from 'lucide-react'

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

function SessionRow({ session, isNew, officer }) {
  const { officer_name, card_uid, clockIn, clockOut } = session
  const fmt = formatTime
  const event = clockIn ?? clockOut
  const unlinked = Boolean(event?.is_unlinked)
  const card = event?.nfc_uid ?? nfcUid(officer,card_uid)

  return (
    <tr className={`border-b border-white/5 transition-all duration-500 ${isNew ? 'bg-brand-500/10 animate-fade-in' : 'hover:bg-white/3'}`}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500/30 to-violet-500/30 border border-white/10 flex items-center justify-center text-xs font-bold text-brand-300">
            {unlinked ? '?' : officer_name?.charAt(0) ?? '?'}
          </div>
          <div>
            <p className={`font-medium text-slate-100 ${unlinked ? 'font-mono' : ''}`}>{unlinked ? card : officer_name ?? card_uid}</p>
            {unlinked ? <p className="text-xs text-amber-300">Unlinked card</p> : <p className="text-xs text-slate-500 font-mono">{card || 'No card linked'}</p>}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-slate-400 text-sm font-mono">
        {fmt(clockIn?.timestamp)}
      </td>
      <td className="px-4 py-3 text-sm font-mono">
        {clockOut ? (
          <span className="text-slate-400">{fmt(clockOut.timestamp)}{clockOut.is_auto_closed && <span className="block text-xs text-slate-500">Auto-closed</span>}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            On Duty
          </span>
        )}
      </td>
    </tr>
  )
}

export default function LiveKiosk() {
  const { activeSemester }        = useSemester()
  const [logs, setLogs]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [connected, setConnected] = useState(false)
  const [error,setError] = useState('')
  const [retry,setRetry] = useState(0)
  const [newUids, setNewUids]     = useState(new Set())
  const prevUids = useRef(new Set())

  const [dayKey, setDayKey] = useState(() => dateKey())
  useEffect(() => {
    const timer = setInterval(() => setDayKey(dateKey()), 30000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    setLoading(true)
    setLogs([]);setConnected(false);setError('')
    setNewUids(new Set())
    prevUids.current = new Set()
    let highlightTimer
    let stopped = false
    const recover = () => recoverAttendance().catch(e=>{if(!stopped) setError('Attendance recovery pending: '+e.message)})
    recover()
    const timer=setInterval(recover,30000)
    const unsub = watchLiveAttendance((snapshot) => {
        const incoming = snapshot.events
        if (snapshot.date !== dayKey) setDayKey(snapshot.date)
        // Detect newly active officer UIDs
        const freshUids = new Set()
        incoming.forEach(doc => {
          if (!prevUids.current.has(doc.card_uid)) freshUids.add(doc.card_uid)
        })
        prevUids.current = new Set(incoming.map(d => d.card_uid))

        if (freshUids.size > 0) {
          setNewUids(freshUids)
          clearTimeout(highlightTimer)
          highlightTimer = setTimeout(() => setNewUids(new Set()), 2500)
        }

        setLogs(incoming)
        setLoading(false)
        setConnected(true);setError('')
      },
      (err) => {
        console.error('Attendance subscription error:', err)
        setConnected(false);setError(err.message || 'Live attendance unavailable. Check the connection and retry.')
        setLoading(false)
      },
    )

    return () => {stopped=true;clearInterval(timer);clearTimeout(highlightTimer);unsub()}
  }, [dayKey,retry])

  return <LiveKioskBoard logs={logs} dayKey={dayKey} activeSemester={activeSemester} loading={loading} connected={connected} error={error} newUids={newUids} onRetry={()=>setRetry(value=>value+1)} />
}

export function LiveKioskBoard({ logs, dayKey, activeSemester, loading, connected, error, newUids = new Set(), onRetry }) {
  const today = new Date(dayKey + 'T12:00:00')
  const sessions   = buildAttendanceSessions(logs)
  const latest = latestAttendanceByOfficer(logs)
  const onDutyNow = [...latest.values()].filter(log=>log.type === 'CLOCK_IN').length
  const clockedOut = new Set(sessions.filter(s => s.clockOut).map(s => s.card_uid)).size
  const totalOfficers = new Set(logs.map(l => l.card_uid)).size
  const unlinkedCards = new Set(logs.filter(log => log.is_unlinked).map(log => log.card_uid)).size

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

      {error && <div role="alert" className="card p-4 text-amber-300">{error}<button className="btn-secondary ml-3" onClick={onRetry}>Retry</button></div>}
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Users}  label="Attendees Today"   value={totalOfficers}            accent="brand"   />
        <StatCard icon={Clock}  label="Currently On Duty" value={Math.max(0, onDutyNow)}  accent="emerald" />
        <StatCard icon={LogOut} label="Clocked Out"       value={clockedOut}               accent="amber"  />
      </div>
      {unlinkedCards > 0 && <p className="text-xs text-amber-300">{unlinkedCards} unlinked card{unlinkedCards === 1 ? '' : 's'} included in live counts. These scans stay out of officer analytics until an admin links the card owner.</p>}

      {/* Session table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-semibold text-white text-sm">Today's Attendance Events</h2>
          <span className="text-xs text-slate-500">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mr-3" />
            Loading…
          </div>
        ) : sessions.length === 0 ? (
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
                  <th>Officer / Card</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session, i) => (
                  <SessionRow
                    key={`${session.card_uid}-${i}`}
                    session={session}
                    isNew={newUids.has(session.card_uid)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
