import React, { useEffect, useMemo, useState } from 'react'
import { Activity, AlertCircle, ArrowDownToLine, CheckCircle2, ChevronDown, Clock3, Search, Sparkles, Users } from 'lucide-react'
import Select from './Select'
import { bucketAttendanceTrend } from '../utils/attendanceAnalytics'
import { serializeCSV } from '../utils/csv'

const number = value => value.toLocaleString(undefined, { maximumFractionDigits: 1 })
const shortDate = day => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))
const period = bucket => bucket.from === bucket.to ? shortDate(bucket.from) : `${shortDate(bucket.from)} – ${shortDate(bucket.to)}`
const colors = { present: '#34d399', absent: '#fb7185', pending: '#fbbf24', volunteers: '#818cf8' }
const legend = { present: 'Assigned present', absent: 'Absent', pending: 'Pending', volunteers: 'Voluntary' }

function AnimatedNumber({ value, suffix = '' }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setDisplay(value); return }
    let frame, start
    const tick = time => {
      start ??= time
      const progress = Math.min((time - start) / 850, 1)
      setDisplay(value * (1 - (1 - progress) ** 3))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return <><span aria-hidden="true">{number(Number.isInteger(value) ? Math.round(display) : Math.round(display * 10) / 10)}{suffix}</span><span className="sr-only">{number(value)}{suffix}</span></>
}

function Metric({ label, value, suffix, detail, icon: Icon, accent, index }) {
  return <article className="card analytics-metric p-5 relative overflow-hidden" style={{ '--accent': accent, animationDelay: `${index * 75}ms` }}>
    <div className="flex items-center justify-between gap-3 mb-4">
      <p className="text-sm text-slate-400">{label}</p>
      <span className="analytics-icon rounded-xl p-2.5"><Icon className="w-5 h-5" /></span>
    </div>
    <p className="text-3xl font-bold text-white tabular-nums tracking-tight">{value == null ? '—' : <AnimatedNumber value={value} suffix={suffix} />}</p>
    <p className="text-xs text-slate-400 mt-2 leading-relaxed">{detail}</p>
  </article>
}

function AttendanceTrend({ daily }) {
  const buckets = useMemo(() => bucketAttendanceTrend(daily), [daily])
  const [selected, setSelected] = useState(0)
  const current = buckets[Math.min(selected, buckets.length - 1)]
  const maximum = Math.max(1, ...buckets.map(b => Object.keys(colors).reduce((n, key) => n + b[key], 0)))
  return <section className="card p-5 sm:p-6 analytics-enter" style={{ animationDelay: '180ms' }} aria-labelledby="trend-title">
    <div className="flex justify-between gap-4 flex-wrap">
      <div><h2 id="trend-title" className="text-white font-semibold">Attendance over time</h2>
        <p className="text-xs text-slate-400 mt-1">Officer-days across {daily.length} days. Hover or select a bar for details.</p></div>
      <div className="flex gap-x-4 gap-y-2 flex-wrap text-xs text-slate-400">{Object.entries(legend).map(([key, label]) =>
        <span key={key} className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors[key] }} />{label}</span>)}</div>
    </div>
    <div className="relative mt-6 pl-8">
      <div aria-hidden="true" className="absolute inset-y-0 left-0 text-[10px] text-slate-500 flex flex-col justify-between pb-1"><span>{maximum}</span><span>{Math.round(maximum / 2)}</span><span>0</span></div>
      <div aria-hidden="true" className="absolute inset-0 left-8 flex flex-col justify-between pointer-events-none">{[0, 1, 2].map(n => <div key={n} className="border-t border-white/5" />)}</div>
      <div className="relative flex h-48 gap-1 sm:gap-2 items-end" role="group" aria-label="Attendance trend bars">
        {buckets.map((bucket, index) => <button key={bucket.from} type="button" aria-pressed={current === bucket}
          aria-label={`${period(bucket)}: ${bucket.present} assigned present, ${bucket.absent} absent, ${bucket.pending} pending, ${bucket.volunteers} voluntary officer-days`}
          onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onClick={() => setSelected(index)}
          className={`flex-1 h-full min-w-0 flex flex-col justify-end rounded-t-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-400 ${current === bucket ? 'bg-white/10' : 'hover:bg-white/5'}`}>
          <span className="w-full h-full flex flex-col justify-end analytics-bar" style={{ animationDelay: `${index * 20}ms` }}>
            {['volunteers', 'pending', 'absent', 'present'].map(key => <span key={key} className="block w-full shrink-0 first:rounded-t-sm" style={{ height: `${bucket[key] / maximum * 100}%`, backgroundColor: colors[key], opacity: current === bucket ? 1 : 0.65 }} />)}
          </span>
        </button>)}
      </div>
      <div className="flex justify-between gap-2 text-[10px] text-slate-500 mt-3"><span>{daily[0] && shortDate(daily[0].date)}</span><span>{daily.at(-1) && shortDate(daily.at(-1).date)}</span></div>
    </div>
    {current && <div className="mt-5 rounded-xl bg-slate-950/50 border border-white/5 p-3 text-xs flex flex-wrap gap-x-4 gap-y-2" aria-live="polite">
      <span className="font-semibold text-slate-200">{period(current)}</span>
      {Object.entries(legend).map(([key, label]) => <span key={key} className="text-slate-400">{label} <strong style={{ color: colors[key] }}>{current[key]}</strong></span>)}
    </div>}
  </section>
}

function Fulfillment({ summary }) {
  return <section className="card p-5 sm:p-6 analytics-enter" style={{ animationDelay: '240ms' }} aria-labelledby="fulfillment-title">
    <h2 id="fulfillment-title" className="font-semibold text-white">Required attendance</h2>
    <p className="text-xs text-slate-400 mt-1">Finalized days only · closes at 9 PM</p>
    <div className="relative w-44 h-44 mx-auto my-5">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r="49" fill="none" stroke={summary.required ? '#fb7185' : '#1e293b'} strokeWidth="9" opacity="0.25" />
        <circle className="analytics-ring" cx="60" cy="60" r="49" fill="none" stroke="#34d399" strokeWidth="9" strokeLinecap="round" pathLength="100"
          strokeDasharray="100 100" strokeDashoffset={100 - (summary.rate ?? 0)} style={{ '--ring-offset': 100 - (summary.rate ?? 0), opacity: summary.rate ? 1 : 0 }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center"><p className="font-bold text-3xl tabular-nums">{summary.rate == null ? '—' : <AnimatedNumber value={summary.rate} suffix="%" />}</p><span className="text-xs text-slate-400 mt-1">{summary.required ? 'fulfillment' : 'No finalized duties'}</span></div>
    </div>
    <dl className="space-y-3 text-sm">
      <div className="flex justify-between"><dt className="text-slate-400">Assigned present</dt><dd className="text-emerald-400 font-semibold">{summary.present}</dd></div>
      <div className="flex justify-between"><dt className="text-slate-400">Absent</dt><dd className="text-rose-400 font-semibold">{summary.absent}</dd></div>
      <div className="flex justify-between border-t border-white/10 pt-3"><dt className="text-slate-400">Pending duties</dt><dd className="text-amber-300 font-semibold">{summary.pending}</dd></div>
    </dl>
    <p className="text-[11px] leading-relaxed text-slate-500 mt-4">Each officer counts once per assigned day. Pending duties and days still in progress are excluded from the rate.</p>
  </section>
}

function OfficerComparison({ officers, scope }) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState(null)
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return officers.filter(o => [o.name, o.uid, o.position].some(v => v.toLowerCase().includes(query)))
      .sort((a, b) => (sort === 'rate' ? (b.rate ?? -1) - (a.rate ?? -1) : sort === 'absent' ? b.absentDays - a.absentDays : sort === 'hours' ? b.seconds - a.seconds : 0) || a.name.localeCompare(b.name))
  }, [officers, search, sort])
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10))
  const currentPage = Math.min(page, pageCount - 1)
  const exportSummary = () => {
    const csv = serializeCSV([
      ['Officer attendance analytics', `${scope.from} to ${scope.to}`],
      ['Officer', 'Card UID', 'Position', 'Finalized required days', 'Finalized assigned present', 'Absent days', 'Pending days', 'Fulfillment (%)', 'Voluntary days', 'Visits', 'Recorded hours', 'Incomplete visits', 'Unpaired clock-outs', 'Auto-closed visits'],
      ...filtered.map(o => [o.name, o.uid, o.position, o.finalizedAssigned, o.finalizedPresent, o.absentDays, o.pendingDays, o.rate ?? '', o.voluntaryDays, o.visits, (o.seconds / 3600).toFixed(2), o.incomplete, o.orphanOuts, o.autoClosed]),
    ])
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url; link.download = `officer_analytics_${scope.from}_${scope.to}.csv`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="card overflow-hidden analytics-enter" style={{ animationDelay: '360ms' }} aria-labelledby="officers-title">
    <div className="p-5 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap"><div><h2 id="officers-title" className="font-semibold text-white">Officer breakdown</h2><p className="text-xs text-slate-400 mt-1">Compare required attendance, voluntary days, and recorded time.</p></div>
        <button className="btn-secondary" onClick={exportSummary} disabled={!filtered.length}><ArrowDownToLine className="w-4 h-4" />Export CSV</button></div>
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48"><Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" /><input aria-label="Search officers" className="input pl-9" placeholder="Search officers…" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} /></div>
        <Select className="w-full sm:w-52" aria-label="Sort officers" value={sort} onChange={e => { setSort(e.target.value); setPage(0) }}><option value="name">Name A–Z</option><option value="rate">Highest attendance rate</option><option value="absent">Most absences</option><option value="hours">Most recorded hours</option></Select>
      </div>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-sm text-left whitespace-nowrap">
      <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-slate-400"><tr>{['Officer', 'Finalized attendance', 'Absent', 'Pending', 'Voluntary days', 'Recorded hours'].map(title => <th key={title} scope="col" className="px-5 py-3 font-semibold">{title}</th>)}</tr></thead>
      <tbody className="divide-y divide-white/5">{filtered.slice(currentPage * 10, currentPage * 10 + 10).map(officer => <OfficerRow key={officer.uid} officer={officer} expanded={expanded === officer.uid} onToggle={() => setExpanded(expanded === officer.uid ? null : officer.uid)} />)}</tbody>
    </table></div>
    {!filtered.length && <p className="text-center text-sm text-slate-500 p-10">{officers.length ? 'No officers match your search.' : 'No officers or assignments found for this period.'}</p>}
    <div className="p-4 flex justify-between gap-3 flex-wrap items-center border-t border-white/5 text-xs text-slate-400"><p>{filtered.length} officers · Search only filters this table and its export.</p>
      {pageCount > 1 && <div className="flex items-center gap-3"><button className="btn-secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage + 1} / {pageCount}</span><button className="btn-secondary" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div>}</div>
  </section>
}

function OfficerRow({ officer: o, expanded, onToggle }) {
  return <>
    <tr className="hover:bg-white/[0.03] transition-colors">
      <td className="px-5 py-4"><button onClick={onToggle} aria-expanded={expanded} aria-controls={`analytics-officer-${o.uid}`} className="flex items-center gap-3 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
        <span aria-hidden="true" className="w-9 h-9 shrink-0 flex items-center justify-center rounded-xl bg-brand-500/10 text-brand-300 font-semibold">{o.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span>
        <span><span className="block font-medium text-slate-200">{o.name}</span><span className="block text-xs text-slate-500">{o.position}</span></span><ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} /></button></td>
      <td className="px-5 py-4"><div className="flex justify-between gap-5 text-xs"><span className="text-slate-400">{o.finalizedPresent} / {o.finalizedAssigned} days</span><span className="text-emerald-400 font-semibold">{o.rate == null ? '—' : `${o.rate}%`}</span></div><div className="h-1.5 mt-2 bg-white/5 rounded-full overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-400 analytics-bar-x" style={{ width: `${o.rate ?? 0}%` }} /></div></td>
      <td className="px-5 py-4 tabular-nums text-rose-300">{o.absentDays}</td><td className="px-5 py-4 tabular-nums text-amber-300">{o.pendingDays}</td><td className="px-5 py-4 tabular-nums text-brand-300">{o.voluntaryDays}</td><td className="px-5 py-4 tabular-nums text-slate-300">{number(o.seconds / 3600)} h</td>
    </tr>
    <tr id={`analytics-officer-${o.uid}`} hidden={!expanded}><td colSpan="6" className="px-5 py-4 bg-brand-500/5"><div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400 animate-fade-in">
      <span>Card: <strong className="font-mono text-slate-300">{o.uid}</strong></span><span>{o.visits} visits</span><span>{o.attendedAssignedDays} / {o.assignedDays} assigned days attended (including open days)</span><span>{o.incomplete} incomplete visits</span><span>{o.openVisits} open visits</span><span>{o.orphanOuts} unpaired clock-outs</span><span>{o.autoClosed} auto-closed visits</span>
    </div></td></tr>
  </>
}

export default function AttendanceAnalytics({ data, scope }) {
  const { summary, weekdays } = data
  const review = summary.incomplete + summary.orphanOuts
  const strongestDay = weekdays.filter(day => day.required).sort((a, b) => b.rate - a.rate || b.required - a.required)[0]
  return <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Attendance fulfillment" value={summary.rate} suffix="%" detail={`${summary.present} of ${summary.required} finalized duty slots attended`} icon={CheckCircle2} accent="#34d399" index={0} />
      <Metric label="Officers who attended" value={summary.uniqueAttendees} detail={`${summary.visits} visits in this period`} icon={Users} accent="#818cf8" index={1} />
      <Metric label="Recorded hours" value={Math.round(summary.seconds / 3600 * 10) / 10} suffix=" h" detail={`${summary.autoClosed} auto-closed visits included`} icon={Clock3} accent="#38bdf8" index={2} />
      <Metric label="Voluntary attendance" value={summary.voluntaryDays} detail="Officer-days attended without a required assignment" icon={Sparkles} accent="#c084fc" index={3} />
    </div>
    {!summary.visits && <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-4 text-sm text-slate-400">No clock-ins in this period. Scheduled duties still appear in the attendance analysis.</div>}
    <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]"><AttendanceTrend daily={data.daily} /><Fulfillment summary={summary} /></div>
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card p-5 sm:p-6 analytics-enter" style={{ animationDelay: '300ms' }} aria-labelledby="weekday-title"><h2 id="weekday-title" className="font-semibold text-white">Attendance by weekday</h2><p className="text-xs text-slate-400 mt-1 mb-5">Fulfillment of finalized required duties</p>
        <div className="space-y-3">{weekdays.map(day => <div key={day.label} className="flex items-center gap-3 text-xs"><span className="w-7 text-slate-400">{day.label}</span><div className="flex-1 rounded-full h-2 bg-white/5 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-sky-400 analytics-bar-x" style={{ width: `${day.rate ?? 0}%` }} /></div><span className="w-24 text-right text-slate-400 tabular-nums">{day.rate == null ? 'No duties' : `${day.present}/${day.required} · ${day.rate}%`}</span></div>)}</div>
      </section>
      <section className="card p-5 sm:p-6 space-y-5 analytics-enter" style={{ animationDelay: '330ms' }} aria-labelledby="insights-title"><h2 id="insights-title" className="font-semibold text-white flex items-center gap-2"><Activity className="w-4 h-4 text-brand-400" />Period insights</h2>
        <div className="flex gap-3"><span className="rounded-lg p-2 h-fit bg-brand-500/10 text-brand-300"><Sparkles className="w-4 h-4" /></span><div><p className="text-sm text-slate-200">{strongestDay ? `${strongestDay.label} has the highest fulfillment` : 'No finalized assignments yet'}</p><p className="text-xs text-slate-400 mt-1 leading-relaxed">{strongestDay ? `${strongestDay.present} of ${strongestDay.required} duty slots attended (${strongestDay.rate}%). Assignment totals vary by weekday.` : 'Rates appear after a day with required officers reaches its 9 PM cutoff.'}</p></div></div>
        <div className="flex gap-3"><span className={`rounded-lg p-2 h-fit ${review ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-400'}`}><AlertCircle className="w-4 h-4" /></span><div><p className="text-sm text-slate-200">{review ? `${review} attendance records need review` : 'No incomplete or unpaired records'}</p><p className="text-xs text-slate-400 mt-1 leading-relaxed">{summary.incomplete} visits missing a clock-out after cutoff · {summary.orphanOuts} clock-outs without a clock-in. {summary.openVisits} open visits before cutoff.</p></div></div>
        <p className="text-[11px] leading-relaxed text-slate-500 border-t border-white/10 pt-4">Hours use paired clock-ins and clock-outs, including automatic 9 PM closures. Open and unpaired visits add no time. No Classes and Optional attendance is voluntary. Attendance means a recorded clock-in; no minimum-hours rule is applied.</p>
      </section>
    </div>
    <OfficerComparison officers={data.officers} scope={scope} />
  </div>
}
