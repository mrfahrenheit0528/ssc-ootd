import React, { useState } from 'react'
import { Search } from 'lucide-react'
import Select from './Select'
import { directoryOfficers, officerGroups } from '../utils/directoryOrder'

export const ASSIGNMENT_DAYS = [
  { day: 1, label: 'Monday' }, { day: 2, label: 'Tuesday' }, { day: 3, label: 'Wednesday' },
  { day: 4, label: 'Thursday' }, { day: 5, label: 'Friday' }, { day: 6, label: 'Saturday' }, { day: 0, label: 'Sunday' },
]
const blank = { type: 'unscheduled', required_uids: [] }
export default function WeeklyAssignmentGrid({ officers, schedule, disabled = false, onChange }) {
  const [search, setSearch] = useState('')
  const selected = Object.values(schedule).flatMap(entry => entry.required_uids)
  const ordered = directoryOfficers(officers, selected)
  const groups = officerGroups(ordered, search)
  const visible = groups.flatMap(group => group.officers)
  const toggle = (day, uid) => {
    const entry = schedule[day] ?? blank
    onChange(day, { required_uids: entry.required_uids.includes(uid) ? entry.required_uids.filter(id => id !== uid) : [...entry.required_uids, uid] })
  }
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="relative block w-full sm:max-w-sm"><span className="sr-only">Find an officer for weekly assignments</span><Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input type="search" className="input pl-9" placeholder="Find a name or position..." value={search} onChange={event => setSearch(event.target.value)} /></label>
      <span className="text-xs text-slate-400">{visible.length} of {ordered.length} officers shown</span>
    </div>
    <p className="text-xs text-slate-400">Directory position order, with names A–Z within each position. Set a day to Scheduled, then tick the officers in that column.</p>
    <div className="overflow-auto max-h-[65vh] rounded-xl border border-white/10" tabIndex={0} role="region" aria-label="Weekly officer assignment table">
      <table className="w-full min-w-[1000px] border-collapse text-sm">
        <caption className="sr-only">Weekly assignments by officer, Monday through Sunday</caption>
        <thead className="sticky top-0 z-20 bg-slate-900"><tr>
          <th scope="col" className="sticky left-0 z-30 min-w-56 bg-slate-900 p-4 text-left align-top text-slate-300">Officer / position</th>
          {ASSIGNMENT_DAYS.map(({ day, label }) => {
            const entry = schedule[day] ?? blank, isScheduled = entry.type === 'scheduled'
            const candidates = visible.filter(officer => officer.active !== false || entry.required_uids.includes(officer.card_uid))
            const allSelected = candidates.length > 0 && candidates.every(officer => entry.required_uids.includes(officer.card_uid))
            const bulk = () => {
              const ids = new Set(candidates.map(officer => officer.card_uid))
              onChange(day, { required_uids: allSelected ? entry.required_uids.filter(uid => !ids.has(uid)) : [...new Set([...entry.required_uids, ...ids])] })
            }
            return <th key={day} scope="col" className="min-w-28 border-l border-white/5 px-2 py-3 align-top font-normal">
              <span className="block font-semibold text-slate-200 mb-2">{label}</span>
              <Select aria-label={`${label} schedule`} className="input text-xs px-2 py-2 w-full" disabled={disabled} value={entry.type} onChange={event => onChange(day, { type: event.target.value, required_uids: event.target.value === 'unscheduled' ? [] : entry.required_uids })}><option value="scheduled">Scheduled</option><option value="unscheduled">Unscheduled</option></Select>
              <span className={`block text-xs mt-2 ${isScheduled && !entry.required_uids.length ? 'text-amber-300' : 'text-slate-500'}`}>{isScheduled ? `${entry.required_uids.length} assigned` : 'No recurring duty'}</span>
              {isScheduled && <button type="button" className="text-[11px] mt-1 min-h-8 rounded-md px-2 text-brand-300 hover:bg-brand-500/10 hover:text-brand-200 disabled:opacity-40" disabled={disabled || !candidates.length} aria-label={`${allSelected ? 'Clear' : 'Select'} shown officers on ${label}`} onClick={bulk}>{allSelected ? 'Clear shown' : 'Select shown'}</button>}
            </th>
          })}
        </tr></thead>
        {groups.map(group => <tbody key={group.key} aria-label={group.label}>
          <tr className="bg-slate-800/80"><th scope="rowgroup" colSpan={8} className="p-0 text-left"><span className="sticky left-0 inline-block px-4 py-2 text-[11px] uppercase tracking-wide text-slate-400">{group.label} <span className="text-slate-500">({group.officers.length})</span></span></th></tr>
          {group.officers.map(officer => <tr key={officer.card_uid} className="border-t border-white/5 hover:bg-white/[0.03]">
            <th scope="row" className="sticky left-0 z-10 bg-slate-900 px-4 py-3 text-left font-normal"><span className="block text-slate-200">{officer.first_name} {officer.last_name}{officer.active === false && <span className="ml-1 text-xs text-amber-300">(Inactive)</span>}</span><span className="block text-xs text-slate-500 mt-0.5">{officer.position || 'Officer'}</span></th>
            {ASSIGNMENT_DAYS.map(({ day, label }) => {
              const entry = schedule[day] ?? blank, checked = entry.required_uids.includes(officer.card_uid)
              const locked = disabled || entry.type !== 'scheduled' || (officer.active === false && !checked)
              return <td key={day} className={`border-l border-white/5 text-center ${entry.type === 'unscheduled' ? 'bg-slate-950/30' : checked ? 'bg-brand-500/10' : ''}`}><label className={`flex min-h-14 w-full items-center justify-center ${locked ? 'cursor-default' : 'cursor-pointer'}`}><input type="checkbox" className={`h-4 w-4 accent-indigo-500 ${checked ? 'disabled:opacity-90' : 'disabled:opacity-25'}`} aria-label={`Assign ${officer.first_name} ${officer.last_name} on ${label}`} checked={checked} disabled={locked} onChange={() => toggle(day, officer.card_uid)} /></label></td>
            })}
          </tr>)}
        </tbody>)}
      </table>
      {!visible.length && <p className="sticky left-0 p-5 text-sm text-slate-400">{ordered.length ? 'No officers match your search.' : 'Add officer profiles in Officer Roster before assigning duties.'}</p>}
    </div>
    <p className="text-xs text-slate-500">Select shown / Clear shown affects only the officers visible in your search. Scroll sideways to reach all seven days on a smaller screen.</p>
  </div>
}
