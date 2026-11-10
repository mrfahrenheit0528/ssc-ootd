import Select from '../components/Select'
import { useEffect, useRef, useState } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, parseISO } from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { listRecords, recoverAttendance } from '../data'
import { useSemester } from '../contexts/SemesterContext'
import { fetchAttendanceContext, exportCSVReport, exportXLSXReport } from '../utils/reportExport'
import { analyzeAttendanceData } from '../utils/attendance'
import DayTypeLegend from '../components/DayTypeLegend'
import { ScheduleIndicator, ScheduleLegend } from '../components/ScheduleIndicator'
import { dateKey, dateBounds } from '../utils/attendanceTime'

export default function Calendar() {
  const { semesters } = useSemester()
  const [month,setMonth] = useState(() => startOfMonth(parseISO(dateKey())))
  const [semesterId,setSemesterId] = useState('')
  const [result,setResult] = useState(null), [selected,setSelected] = useState(null)
  const [loading,setLoading] = useState(false), [error,setError] = useState('')
  const [retry,setRetry] = useState(0)
  const generation = useRef(0)
  const monthFrom = format(startOfMonth(month),'yyyy-MM-dd'), monthTo = format(endOfMonth(month),'yyyy-MM-dd')
  useEffect(() => {
    const current = ++generation.current
    setLoading(true); setError(''); setSelected(null)
    async function load() {
      try {
        await recoverAttendance()
        const context = await fetchAttendanceContext(semesterId)
        const term = context.semesters.find(s => s.id === semesterId)
        const from = term && term.start_date > monthFrom ? term.start_date : monthFrom
        const to = term?.end_date && term.end_date < monthTo ? term.end_date : monthTo
        const logs = from <= to ? await listRecords('attendance_logs',{...dateBounds(from,to),orderBy:'timestamp'}) : []
        if (current !== generation.current) return
        const options = {logs,dateFrom:from,dateTo:to,context,officerMap:context.officerMap,selectedSemester:semesterId,semesters:context.semesters}
        setResult({scope:`${monthFrom}|${monthTo}|${semesterId}`,options,days:from <= to ? analyzeAttendanceData(options).dailyReports : []})
      } catch(e) { if(current === generation.current) setError(e.message) }
      finally { if(current === generation.current) setLoading(false) }
    }
    load()
    return () => { generation.current++ }
  },[monthFrom,monthTo,semesterId,retry])
  const days = eachDayOfInterval({start:startOfMonth(month),end:endOfMonth(month)})
  const currentScope = result?.scope === `${monthFrom}|${monthTo}|${semesterId}`
  const exportReport = kind => {
    if(loading || error || !currentScope || !result?.days.length) return
    try {
      if(kind === 'xlsx') exportXLSXReport(result.options)
      else exportCSVReport({...result.options,label:`${monthFrom}_to_${monthTo}`})
      toast.success('Report downloaded.')
    } catch(e) { toast.error(e.message) }
  }
  return <div className="space-y-5 animate-slide-up">
    <div className="flex gap-3 flex-wrap justify-between"><h1 className="text-2xl font-bold flex gap-3"><CalendarDays />Attendance Calendar</h1><div className="flex gap-2"><button className="btn-secondary" disabled={loading || !!error || !currentScope || !result?.days.length} onClick={() => exportReport('csv')}>CSV</button><button className="btn-primary" disabled={loading || !!error || !currentScope || !result?.days.length} onClick={() => exportReport('xlsx')}>Excel report</button></div></div>
    <p className="text-sm text-slate-400">Assigned attendance and volunteers are counted separately. Absences finalize at 9 PM (Asia/Manila). Admins manage day types in Day Config.</p>
    <div className="card p-4 flex flex-wrap items-center justify-between gap-4">
      <Select aria-label="Calendar semester" className="input max-w-sm" value={semesterId} onChange={e => {setSemesterId(e.target.value); const term=semesters.find(s=>s.id===e.target.value); if(term) setMonth(startOfMonth(parseISO(term.start_date)))}}><option value="">All semesters</option>{semesters.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
      <div className="flex gap-3 items-center"><button className="btn-secondary p-2" aria-label="Previous month" onClick={() => setMonth(m=>addMonths(m,-1))}><ChevronLeft /></button><span>{format(month,'MMMM yyyy')}</span><button className="btn-secondary p-2" aria-label="Next month" onClick={() => setMonth(m=>addMonths(m,1))}><ChevronRight /></button><button className="btn-secondary" onClick={()=>setRetry(v=>v+1)}>Refresh</button></div>
    </div>
    <div className="space-y-2"><DayTypeLegend /><ScheduleLegend /></div>
    {error && <div role="alert" className="card p-4 text-red-300">Could not load calendar: {error}<button className="btn-secondary ml-3" onClick={()=>setRetry(v=>v+1)}>Retry</button></div>}
    {loading || !currentScope && !error ? <p className="text-slate-400">Loading calendar...</p> : !error && <div className="card p-2 sm:p-4 grid grid-cols-7 gap-1 sm:gap-2">
      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><div className="text-center text-xs text-slate-400" key={d}>{d}</div>)}
      {Array.from({length:days[0].getDay()},(_,i)=><div key={`pad-${i}`} />)}
      {days.map(day=>{const ds=format(day,'yyyy-MM-dd'),report=result?.days.find(d=>d.date===ds);return <button key={ds} data-day-type={report?.dayType} disabled={!report} onClick={()=>setSelected(report)} className={`calendar-day p-1 sm:p-3 min-h-24 sm:min-h-32 rounded-lg border text-left border-white/10 ${!report ? 'opacity-20' : ''}`}>
        <span className="flex items-center justify-between gap-1"><span className={ds===dateKey()?'text-brand-300 font-bold':'text-slate-200'}>{day.getDate()}</span>{report && <ScheduleIndicator type={report.scheduleType} dayType={report.dayType} />}</span>{report && <><span className="sr-only">{report.dayTypeLabel}</span>{!['unscheduled','no_classes','optional'].includes(report.status) && <span className="block text-[10px] sm:text-xs mt-1">{report.fulfillmentStatus}</span>}<span className="hidden sm:block text-xs text-slate-400">Assigned: {report.requiredAttendedCount}/{report.requiredCount}</span>{report.voluntaryOfficersCount>0 && <span className="hidden sm:block text-xs text-violet-300">{report.voluntaryOfficersCount} volunteer(s)</span>}</>}
      </button>})}
    </div>}
    {selected && <div role="dialog" aria-modal="true" aria-labelledby="attendance-day-title" className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 animate-fade-in"><div className="card bg-slate-900 max-w-4xl w-full p-5 max-h-[90vh] overflow-auto space-y-4 animate-slide-up">
      <div className="flex justify-between gap-3"><h2 id="attendance-day-title" className="font-semibold">{selected.date} - {selected.dayTypeLabel}</h2><button aria-label="Close attendance day" onClick={()=>setSelected(null)}><X /></button></div>
      <p className="text-sm text-slate-400">{selected.fulfillmentStatus} | Assigned present {selected.requiredAttendedCount}/{selected.requiredCount} | Absent {selected.requiredAbsentCount} | Pending {selected.pendingCount} | Volunteers {selected.voluntaryOfficersCount}</p>
      {selected.dayNote && <p className="text-sm">{selected.dayNote}</p>}
      {!selected.rows.length ? <p>No attendance or required assignments for this day.</p> : <div className="table-wrapper"><table className="data-table"><thead><tr>{['Officer','Assignment','Status','Clock In','Clock Out','Duration'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{selected.rows.map((r,i)=><tr key={r.clockIn?.id ?? r.clockOut?.id ?? `${r.card_uid}-${i}`}><td>{r.officer_name}</td><td>{r.isAssigned?'Assigned':'Voluntary'}</td><td>{r.status}</td><td>{r.clockInTime}</td><td>{r.clockOutTime}</td><td>{r.duration}</td></tr>)}</tbody></table></div>}
    </div></div>}
  </div>
}
