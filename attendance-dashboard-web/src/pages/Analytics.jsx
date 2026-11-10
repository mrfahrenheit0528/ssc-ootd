import { useEffect, useRef, useState } from 'react'
import { BarChart3, RefreshCw, ShieldCheck } from 'lucide-react'
import AttendanceAnalytics from '../components/AttendanceAnalytics'
import Select from '../components/Select'
import { useSemester } from '../contexts/SemesterContext'
import { useHistoryFilters } from '../hooks/useHistoryFilters'
import { listRecords, recoverAttendance } from '../data'
import { fetchAttendanceContext } from '../utils/reportExport'
import { reportDays } from '../utils/attendance'
import { buildAttendanceAnalytics } from '../utils/attendanceAnalytics'
import { dateBounds, formatTime } from '../utils/attendanceTime'

export default function Analytics() {
  const { semesters, activeSemester, loading: semesterLoading, error: semesterError } = useSemester()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const load = async (from, to, semesterId = '') => {
    const current = ++generation.current
    setError('')
    setLoading(true)
    try {
      if (!from || !to || from > to) throw new Error('Choose a valid date range.')
      reportDays(from, to)
      const term = semesters.find(s => s.id === semesterId)
      if (semesterId && (!term || from < term.start_date || (term.end_date && to > term.end_date))) throw new Error('Choose dates within the selected semester.')
      await recoverAttendance()
      const [logs, context] = await Promise.all([
        listRecords('attendance_logs', { ...dateBounds(from, to), orderBy: 'timestamp' }),
        fetchAttendanceContext(semesterId),
      ])
      if (current !== generation.current) return
      const now = new Date()
      setReport({ data: buildAttendanceAnalytics({ logs, context, dateFrom: from, dateTo: to, now }),
        scope: { from, to, semesterId }, updated: now })
    } catch (e) {
      if (current === generation.current) setError(`Could not load analytics: ${e.message}`)
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }
  const filters = useHistoryFilters({ semesters, activeSemester, loading: semesterLoading, error: semesterError, load })
  const { from, to, semesterId } = filters
  const selectedTerm = semesters.find(term => term.id === semesterId)
  const stale = !report || report.scope.from !== from || report.scope.to !== to || report.scope.semesterId !== semesterId
  const ready = !stale && !loading && !error && !semesterLoading && !semesterError
  const refresh = () => load(from, to, semesterId)
  useEffect(() => () => { generation.current++ }, [])
  const preset = days => {
    if (!filters.applyPreset(days)) setError('That date range falls outside the selected semester. Choose another range or semester.')
  }
  return <div className="space-y-6 animate-slide-up analytics-page">
    <header className="relative overflow-hidden rounded-2xl border border-brand-500/20 bg-gradient-to-br from-brand-950/70 via-slate-900/80 to-slate-950 p-6 sm:p-8">
      <div className="analytics-glow" aria-hidden="true" />
      <div className="relative flex justify-between items-start gap-4 flex-wrap">
        <div><span className="inline-flex gap-1.5 items-center text-[10px] uppercase tracking-[0.18em] text-brand-300 font-semibold mb-3"><ShieldCheck className="w-3.5 h-3.5" />Admin insights</span>
          <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3"><BarChart3 className="w-7 h-7 text-brand-400" />Attendance Analytics</h1>
          <p className="text-sm text-slate-400 mt-2 max-w-xl leading-relaxed">See participation patterns, understand required attendance, and explore each officer’s contribution.</p>
        </div>
        <button className="btn-secondary" disabled={loading || semesterLoading || Boolean(semesterError)} onClick={refresh}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh report</button>
      </div>
    </header>

    <form className="card p-5 space-y-4" onSubmit={event => { event.preventDefault(); refresh() }} aria-label="Analytics filters">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div className="w-full sm:w-80"><label htmlFor="analytics-semester" className="label">Semester</label><Select id="analytics-semester" value={semesterId} disabled={semesterLoading || Boolean(semesterError)} onChange={event => filters.chooseSemester(event.target.value)}>
          <option value="">All semesters / custom period</option>{semesters.map(term => <option key={term.id} value={term.id}>{term.name}{term.status === 'active' ? ' (Active)' : ' (Archived)'}</option>)}
        </Select></div>
        <div className="flex flex-wrap gap-2">{[{ label: 'Today', days: 0 }, { label: 'Last 7 days', days: 7 }, { label: 'Last 30 days', days: 30 }].map(item => <button key={item.days} type="button" className="btn-secondary text-xs" disabled={semesterLoading || Boolean(semesterError)} onClick={() => preset(item.days)}>{item.label}</button>)}</div>
      </div>
      <div className="flex flex-wrap gap-3 items-end border-t border-white/10 pt-4">
        <div className="flex-1 min-w-40"><label htmlFor="analytics-from" className="label">From</label><input className="input" type="date" id="analytics-from" required min={selectedTerm?.start_date} max={selectedTerm?.end_date || undefined} value={from} onChange={event => filters.setFrom(event.target.value)} /></div>
        <div className="flex-1 min-w-40"><label htmlFor="analytics-to" className="label">To</label><input className="input" type="date" id="analytics-to" required min={from || selectedTerm?.start_date} max={selectedTerm?.end_date || undefined} value={to} onChange={event => filters.setTo(event.target.value)} /></div>
        <button className="btn-primary" type="submit" disabled={loading || semesterLoading || Boolean(semesterError)}>Analyze attendance</button>
      </div>
    </form>

    {error && <div role="alert" className="card p-5 border-rose-500/20 text-sm text-rose-300 flex items-center gap-3 flex-wrap"><span>{error}</span><button className="btn-secondary" disabled={loading || semesterLoading || Boolean(semesterError)} onClick={refresh}>Retry</button></div>}
    <div aria-live="polite" aria-busy={loading || semesterLoading}>
      {loading || semesterLoading ? <div role="status" className="space-y-5"><p className="text-sm text-slate-400 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" />Analyzing attendance…</p><div aria-hidden="true" className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">{[0, 1, 2, 3].map(n => <div key={n} className="card h-40 analytics-skeleton" />)}</div><div aria-hidden="true" className="card h-80 analytics-skeleton" /></div>
        : !error && !semesterError && stale && <p className="card p-6 text-sm text-slate-400">Select Analyze attendance to load the selected period.</p>}
    </div>
    {ready && <>
      <p className="text-xs text-slate-500">{selectedTerm?.name || 'All semesters'} · {report.scope.from} to {report.scope.to} · As of {formatTime(report.updated)} (Asia/Manila)</p>
      <AttendanceAnalytics key={`${report.updated.getTime()}-${report.scope.semesterId}`} data={report.data} scope={report.scope} />
    </>}
  </div>
}
