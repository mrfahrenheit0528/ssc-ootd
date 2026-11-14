import React, { useId, useState } from 'react'
import { directoryOfficers, officerGroups } from '../utils/directoryOrder'

export default function DirectoryOfficerPicker({ officers, value, disabled, onChange }) {
  const [search, setSearch] = useState(''), id = useId()
  const groups = officerGroups(directoryOfficers(officers, value), search)
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2"><label htmlFor={id} className="label mb-0">Find an officer</label><span className="text-xs text-brand-300">{value.length} selected</span></div>
    <input id={id} type="search" className="input" placeholder="Search name or position..." value={search} onChange={event => setSearch(event.target.value)} />
    <div className="space-y-4 max-h-64 overflow-auto">
      {groups.map(group => <fieldset key={group.key}><legend className="text-xs text-slate-400 font-medium mb-2">{group.label}</legend><div className="space-y-1">
        {group.officers.map(officer => <label key={officer.card_uid} className={`flex items-center gap-3 rounded-lg p-2 text-sm ${value.includes(officer.card_uid) ? 'bg-brand-500/10' : 'hover:bg-white/5'}`}>
          <input type="checkbox" className="h-4 w-4 accent-indigo-500" disabled={disabled} checked={value.includes(officer.card_uid)} onChange={() => onChange(value.includes(officer.card_uid) ? value.filter(uid => uid !== officer.card_uid) : [...value, officer.card_uid])} />
          <span><span className="block text-slate-200">{officer.first_name} {officer.last_name}{officer.active === false ? ' (Inactive)' : ''}</span><span className="block text-xs text-slate-500">{officer.position || 'Officer'}</span></span>
        </label>)}
      </div></fieldset>)}
      {!groups.length && <p className="text-sm text-slate-400">No officers match your search.</p>}
    </div>
  </div>
}
