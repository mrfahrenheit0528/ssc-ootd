import Select from '../components/Select'
import Tabs from '../components/Tabs'
import { useState, useEffect, useRef } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, parseISO } from 'date-fns'
import { Save, Settings, ChevronLeft, ChevronRight, X, CalendarDays, CalendarRange } from 'lucide-react'
import toast from 'react-hot-toast'
import { saveWeek, saveCalendarDay } from '../data'
import { useSemester } from '../contexts/SemesterContext'
import { fetchAttendanceContext } from '../utils/reportExport'
import { emptyWeek, resolveDay, resolveDayWithDraft, DAY_TYPE_LABELS } from '../utils/attendance'
import DayTypeLegend from '../components/DayTypeLegend'
import { ScheduleIndicator, ScheduleLegend } from '../components/ScheduleIndicator'
import { dateKey } from '../utils/attendanceTime'

const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
function DayEditor({ day, context, semesterId, officers, onClose, onSaved }) {
  const existing = context.calendarDays.find(d => d.semester_id === semesterId && d.date === day)
  const resolved = resolveDay(day, context)
  const [type, setType] = useState(existing?.type ?? 'regular')
  const [note, setNote] = useState(existing?.note ?? '')
  const [custom, setCustom] = useState(existing?.required_uids != null)
  const [uids, setUids] = useState(existing?.required_uids ?? resolved.scheduled_uids)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    try { await saveCalendarDay(semesterId, day, type, note, custom ? uids : null); await onSaved(); onClose(); toast.success('Calendar day saved.') }
    catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  return <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="calendar-editor-title">
    <div className="card bg-slate-900 p-6 w-full max-w-lg max-h-[90vh] overflow-auto space-y-4 animate-slide-up">
      <div className="flex justify-between"><h2 id="calendar-editor-title" className="font-semibold">{format(parseISO(day), 'MMMM d, yyyy')}</h2><button disabled={saving} onClick={onClose} aria-label="Close day editor"><X /></button></div>
      <label className="label">Calendar day type</label>
      <Select aria-label="Calendar day type" className="input" disabled={saving} value={type} onChange={e => setType(e.target.value)}>{Object.entries(DAY_TYPE_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</Select>
      {type === 'regular' && <p className="text-xs text-slate-400">Required officers follow the semester's weekly assignments unless you choose a different list below.</p>}
      <label className="label">Note</label><input className="input" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} />
      {type === 'regular' ? (
        <div key="required-officers" className="space-y-3 animate-fade-in">
          <label className="flex gap-2 text-sm">
            <input type="checkbox" checked={custom} disabled={saving} onChange={e => setCustom(e.target.checked)} />
            Use a different officer list for this date
          </label>
          {!custom && <p className="text-xs text-slate-400">The weekly assignment is preserved. An empty custom list explicitly means no officers are required.</p>}
          {custom && <div className="space-y-2 max-h-48 overflow-auto">
            {officers.filter(o => o.active !== false || uids.includes(o.card_uid)).map(o => (
              <label key={o.card_uid} className="flex gap-2 text-sm">
                <input type="checkbox" checked={uids.includes(o.card_uid)} disabled={saving}
                  onChange={() => setUids(list => list.includes(o.card_uid) ? list.filter(v => v !== o.card_uid) : [...list,o.card_uid])} />
                {o.first_name} {o.last_name}{o.active === false ? ' (Inactive)' : ''}
              </label>
            ))}
          </div>}
        </div>
      ) : (
        <p key="voluntary-attendance" role="status" className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300 animate-fade-in">
          No officers are required on this date. Any attendance will be recorded as voluntary.
        </p>
      )}
      <div className="flex justify-end gap-2"><button className="btn-secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save day'}</button></div>
    </div>
  </div>
}
export default function DayConfig() {
  const { semesters, activeSemester } = useSemester()
  const [semesterId, setSemesterId] = useState('')
  const [activeTab, setActiveTab] = useState('weekly')
  const [context, setContext] = useState(null)
  const [schedule, setSchedule] = useState(emptyWeek)
  const [month, setMonth] = useState(() => startOfMonth(parseISO(dateKey())))
  const [dirty,setDirty] = useState(false)
  const [selectedDay, setSelectedDay] = useState(null)
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const generation = useRef(0)
  const term = semesters.find(s => s.id === semesterId)
  const readOnly = term?.status !== 'active'
  useEffect(() => { if (!semesterId && activeSemester) setSemesterId(activeSemester.id) }, [activeSemester,semesterId])
  const load = async () => {
    const current = ++generation.current
    if (!semesterId) return
    setLoading(true); setError('')
    try {
      const next = await fetchAttendanceContext(semesterId, semesters)
      if (current !== generation.current) return
      setContext(next)
      const latest = next.scheduleVersions.filter(s => s.semester_id === semesterId).sort((a,b) => b.revision-a.revision)[0]
      setSchedule(latest?.schedule ?? emptyWeek());setDirty(false)
    } catch (e) { if (current === generation.current) setError(e.message) }
    finally { if (current === generation.current) setLoading(false) }
  }
  useEffect(() => { load(); return () => { generation.current++ } }, [semesterId,semesters])
  const changeSemester = id => {
    if(dirty && !window.confirm('Discard unsaved weekly assignments?')) return
    setSemesterId(id); setContext(null); setSelectedDay(null)
    const selected = semesters.find(s => s.id === id)
    if (selected) setMonth(startOfMonth(parseISO(selected.start_date)))
  }
  const save = async () => {
    setSaving(true)
    try { await saveWeek(semesterId,schedule); await load(); toast.success('Semester schedule saved. Earlier days retain their previous assignments.') }
    catch (e) { toast.error(e.message) } finally { setSaving(false) }
  }
  const updateDay = (day, patch) => {setDirty(true);setSchedule(old => ({ ...old, [day]: { ...old[day], ...patch } }))}
  const days = eachDayOfInterval({start:startOfMonth(month),end:endOfMonth(month)})
  return <div className="space-y-6 max-w-5xl animate-slide-up">
    <h1 className="text-2xl font-bold flex gap-3"><Settings />Day Configuration</h1>
    <p className="text-sm text-slate-400">Set the semester's weekly assignments, then use the calendar to mark Regular, No Classes, or Optional dates.</p>
    <label className="label">Semester</label><Select aria-label="Schedule semester" className="input max-w-lg" disabled={loading || saving} value={semesterId} onChange={e => changeSemester(e.target.value)}><option value="">Select a semester</option>{semesters.map(s => <option key={s.id} value={s.id}>{s.name}{s.status === 'ended' ? ' (Archived - read-only)' : ''}</option>)}</Select>
    {!semesters.length && <p>Create a semester on the Semesters page first.</p>}
    {error && <div role="alert" className="card p-4 text-red-300">Could not load the schedule: {error}<button className="btn-secondary ml-3" onClick={load}>Retry</button></div>}
    {loading && <p className="text-slate-400">Loading semester configuration...</p>}
    {context && term && context.selectedSemesterId === semesterId && !loading && !error && <>
      {readOnly && <p className="text-amber-300 text-sm">Archived semester. An admin must reactivate it before changing its schedule.</p>}
      <Tabs label="Day configuration sections" value={activeTab} onValueChange={setActiveTab} tabs={[
        { value:'weekly', label:'Weekly recurring assignments', icon:CalendarRange, badge:dirty ? 'Unsaved' : null, content:(
      <section className="card p-5 space-y-4"><h2 className="font-semibold">Weekly recurring assignments</h2>
        <p className="text-xs text-slate-400">Applies to {term?.name}. Scheduled days require the selected officers; Unscheduled days have no recurring duty. Revisions are retained automatically.</p>
        {WEEKDAYS.map((label,day) => {
          const entry = schedule[day] ?? emptyWeek()[day]
          return <div key={day} className="border border-white/10 rounded-xl p-3 space-y-3">
            <div className="flex flex-wrap gap-3 items-center"><span className="font-medium w-28">{label}</span><Select aria-label={`${label} schedule`} className="input w-44" disabled={readOnly || saving} value={entry.type} onChange={e => updateDay(day,{type:e.target.value,required_uids:e.target.value === 'unscheduled' ? [] : entry.required_uids})}><option value="scheduled">Scheduled</option><option value="unscheduled">Unscheduled</option></Select></div>
            {entry.type === 'scheduled' && <div className="grid sm:grid-cols-2 gap-2">{context.officers.filter(o=>o.active !== false || entry.required_uids.includes(o.card_uid)).map(o => <label className="flex gap-2 text-sm" key={o.card_uid}><input type="checkbox" disabled={readOnly || saving} checked={entry.required_uids.includes(o.card_uid)} onChange={() => updateDay(day,{required_uids:entry.required_uids.includes(o.card_uid) ? entry.required_uids.filter(uid => uid !== o.card_uid) : [...entry.required_uids,o.card_uid]})} />{o.first_name} {o.last_name}{o.active === false ? ' (Inactive)' : ''}</label>)}{!entry.required_uids.length && <p className="text-xs text-amber-300">Select at least one officer.</p>}</div>}
          </div>
        })}
        <button className="btn-primary" disabled={readOnly || saving} onClick={save}><Save className="w-4 h-4" />{saving ? 'Saving...' : 'Save semester schedule'}</button>
      </section>
        ) },
        { value:'calendar', label:'Calendar day types', icon:CalendarDays, content:(
      <section className="card p-4 space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Calendar day types</h2><div className="flex items-center gap-3"><button className="btn-secondary p-2" aria-label="Previous month" onClick={() => setMonth(m => subMonths(m,1))}><ChevronLeft /></button><span>{format(month,'MMMM yyyy')}</span><button className="btn-secondary p-2" aria-label="Next month" onClick={() => setMonth(m => addMonths(m,1))}><ChevronRight /></button></div></div>
        <p className="text-xs text-slate-400">Weekly edits appear here immediately for today and future dates. Earlier dates keep their saved assignments. Save weekly changes before editing an individual date.</p>
        {dirty && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-300 animate-fade-in">
          <span>Preview of unsaved weekly changes. Click Save to apply them.</span>
          <button className="btn-primary" disabled={saving} onClick={save}><Save className="w-4 h-4" />{saving ? 'Saving...' : 'Save semester schedule'}</button>
        </div>}
        <div className="space-y-2"><DayTypeLegend /><ScheduleLegend /></div>
        <div key={`${semesterId}|${format(month,'yyyy-MM')}`} className="calendar-grid calendar-grid-enter grid grid-cols-7 gap-1 sm:gap-2">{WEEKDAYS.map(d => <div key={d} className="text-xs text-center text-slate-400">{d.slice(0,3)}</div>)}{Array.from({length:days[0].getDay()},(_,i) => <div key={`pad-${i}`} />)}{days.map(day => {
          const ds = format(day,'yyyy-MM-dd')
          const cfg = dirty ? resolveDayWithDraft(ds,context,schedule) : resolveDay(ds,context)
          const outside = ds < term.start_date || (term.end_date && ds > term.end_date)
          return <button key={ds} data-day-type={outside ? undefined : cfg.type} disabled={outside || readOnly || saving} onClick={() => {if(dirty) {toast.error('Save weekly assignments before editing an individual date.');return} setSelectedDay(ds)}} className={`calendar-day border rounded-lg p-1 sm:p-3 min-h-20 text-left ${outside ? 'opacity-20' : 'border-white/10'}`}><span className="flex items-center justify-between gap-1"><span className="text-sm">{day.getDate()}</span><ScheduleIndicator type={cfg.schedule_type} dayType={cfg.type} /></span><span className="block text-[10px] sm:text-xs text-slate-400 mt-1">{DAY_TYPE_LABELS[cfg.type]}</span>{cfg.required_uids.length > 0 && <span className="hidden sm:block text-xs text-brand-300">{cfg.required_uids.length} required</span>}</button>
        })}</div>
      </section>
        ) },
      ]} />
    </>}
    {selectedDay && context && <DayEditor key={selectedDay} day={selectedDay} context={context} semesterId={semesterId} officers={context.officers} onClose={() => setSelectedDay(null)} onSaved={load} />}
  </div>
}
