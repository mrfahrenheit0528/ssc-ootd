import React, { useState } from 'react'
import { ArrowUp, ArrowDown, Plus, Trash2, Search } from 'lucide-react'
import Select from './Select'
import DirectoryGroupCombobox from './DirectoryGroupCombobox'
import { councilIssues } from '../utils/semesterRoster'

export default function CouncilRosterEditor({ profiles, members, onMembersChange, positions, onPositionsChange, name, onNameChange, disabled = false, onAddOfficer }) {
  const [query, setQuery] = useState('')
  const issues = councilIssues(members, positions, name)
  const updatePosition = (index, patch) => {
    const previous = positions[index]
    onPositionsChange(positions.map((position, i) => i === index ? { ...position, ...patch } : position))
    if (patch.name !== undefined) onMembersChange(members.map(member => member.position === previous.name ? { ...member, position: patch.name } : member))
  }
  const move = (index, direction) => {
    const next = [...positions]
    ;[next[index], next[index + direction]] = [next[index + direction], next[index]]
    onPositionsChange(next)
  }
  const visible = profiles.filter(profile => `${profile.first_name} ${profile.last_name} ${profile.position || ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`))
  return <div className="space-y-5">
    <label className="block"><span className="label">Term name</span><input className="input" value={name} maxLength={150} disabled={disabled} onChange={event => onNameChange(event.target.value)} placeholder="e.g. SSC Term AY 2026–2027" /></label>
    <section className="space-y-3" aria-label="Council positions">
      <div className="flex justify-between items-center gap-3"><h3 className="font-semibold text-white">Positions & officer limits</h3><button type="button" className="btn-secondary text-xs" disabled={disabled} onClick={() => onPositionsChange([...positions, { name: '', capacity: 1, group: 'Council positions' }])}><Plus className="w-4 h-4" />Add position</button></div>
      <p className="text-xs text-slate-400">Set the number of officers for each position. Leave the limit blank for unlimited seats. The order here also sets the order in Day Config.</p>
      <p className="text-xs text-slate-400">Directory group organizes positions under headings in Day Config, such as Executive officers or Representatives. It does not change attendance rules or officer limits.</p>
      <div className="overflow-x-auto rounded-xl border border-white/10"><table className="w-full text-sm"><thead className="bg-white/5 text-xs text-slate-400"><tr><th className="p-3 text-left">Position</th><th className="p-3 text-left">Directory group</th><th className="p-3 text-left">Limit</th><th className="p-3">Selected</th><th className="p-3">Order / remove</th></tr></thead><tbody>
        {positions.map((position, index) => {
          const count = members.filter(member => member.position === position.name).length
          return <tr key={index} className="border-t border-white/5">
            <td className="p-2"><input aria-label={`Position ${index + 1} name`} className="input min-w-48" maxLength={150} value={position.name} disabled={disabled} onChange={event => updatePosition(index, { name: event.target.value })} /></td>
            <td className="p-2"><DirectoryGroupCombobox label={`Position ${index + 1} group`} groups={positions.map(position=>position.group || '')} value={position.group || ''} disabled={disabled} onChange={group=>updatePosition(index,{group})} /></td>
            <td className="p-2"><input aria-label={`Position ${index + 1} limit`} type="number" min="0" max="99999" step="1" className="input w-24" placeholder="∞" value={position.capacity ?? ''} disabled={disabled} onChange={event => updatePosition(index, { capacity: event.target.value === '' ? null : Number(event.target.value) })} /></td>
            <td className={`p-2 text-center tabular-nums ${position.capacity !== null && count > position.capacity ? 'text-red-300' : 'text-slate-300'}`}>{count}</td>
            <td className="p-2"><div className="flex gap-1 justify-center">
              <button type="button" className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-25" aria-label={`Move position ${index + 1} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp className="w-4 h-4" /></button>
              <button type="button" className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-25" aria-label={`Move position ${index + 1} down`} disabled={disabled || index === positions.length - 1} onClick={() => move(index, 1)}><ArrowDown className="w-4 h-4" /></button>
              <button type="button" className="p-2 rounded-lg hover:bg-red-500/10 disabled:opacity-25" aria-label={`Remove position ${index + 1}`} title={count ? 'Reassign or deselect its officers first' : 'Remove position'} disabled={disabled || count > 0} onClick={() => onPositionsChange(positions.filter((_, i) => i !== index))}><Trash2 className="w-4 h-4" /></button>
            </div></td>
          </tr>
        })}
      </tbody></table>{!positions.length && <p className="p-4 text-sm text-slate-400">Add the positions for this council first.</p>}</div>
    </section>
    <section className="space-y-3" aria-label="Council members">
      <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-white">Choose officers <span className="text-slate-400 text-xs">({members.length} selected)</span></h3>{onAddOfficer && <button type="button" className="btn-secondary text-xs" disabled={disabled || !positions.length || positions.some(position => !position.name.trim())} onClick={onAddOfficer}><Plus className="w-4 h-4" />Add new officer</button>}</div>
      <p className="text-xs text-slate-400">Select returning officers, choose their positions, and deselect anyone no longer serving. Their earlier attendance stays in its original semester.</p>
      <label className="relative block"><Search className="absolute left-3 top-3 w-4 h-4 text-slate-500" /><input aria-label="Find council officers" className="input pl-9" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find an existing officer…" /></label>
      <div className="max-h-96 overflow-y-auto divide-y divide-white/5 rounded-xl border border-white/10">
        {visible.map(profile => {
          const member = members.find(item => item.card_uid === profile.card_uid)
          return <div key={profile.card_uid} className={`flex flex-wrap items-center justify-between gap-3 p-3 ${member ? 'bg-brand-500/5' : ''}`}>
            <label className="flex gap-3 items-center text-sm text-slate-200"><input type="checkbox" className="accent-brand-500" disabled={disabled || !positions.length} checked={Boolean(member)} onChange={event => onMembersChange(event.target.checked ? [...members, { card_uid: profile.card_uid, position: positions.some(position => position.name === profile.position) ? profile.position : positions[0].name }] : members.filter(item => item.card_uid !== profile.card_uid))} /><span>{profile.first_name} {profile.last_name}{profile.active === false && <span className="ml-2 text-xs text-slate-500">Previously inactive</span>}</span></label>
            {member && <Select aria-label={`Position for ${profile.first_name} ${profile.last_name}`} className="max-w-xs text-xs" disabled={disabled} value={member.position} onChange={event => onMembersChange(members.map(item => item.card_uid === profile.card_uid ? { ...item, position: event.target.value } : item))}>
              {!positions.some(position => position.name === member.position) && <option value={member.position}>{member.position || 'Choose a position'}</option>}
              {positions.filter(position => position.name).map((position, i) => <option key={i} value={position.name}>{position.name}</option>)}
            </Select>}
          </div>
        })}
        {!visible.length && <p className="p-4 text-sm text-slate-500">No matching profiles. Add a new officer to include them.</p>}
      </div>
    </section>
    {issues.length > 0 && <ul role="alert" className="space-y-1 text-xs text-amber-300 rounded-xl bg-amber-500/5 p-3">{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
  </div>
}
