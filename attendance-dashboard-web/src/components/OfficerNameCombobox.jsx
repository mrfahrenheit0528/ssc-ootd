import React, { useId, useRef, useState } from 'react'
import { ChevronDown, UserPlus } from 'lucide-react'
import { nfcUid } from '../utils/officerIdentity'

export default function OfficerNameCombobox({ value, officers, disabled, onChange, onSelect }) {
  const id = useId(), root = useRef(null)
  const [open, setOpen] = useState(false), [active, setActive] = useState(-1)
  const query = value.trim().toLowerCase()
  const options = officers.filter(o => o.active !== false && !nfcUid(o)
    && (!query || `${o.first_name} ${o.last_name}`.toLowerCase().includes(query)))
  const choose = officer => { onSelect(officer); setOpen(false); setActive(-1) }
  return <div ref={root} className="relative" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <label className="label" htmlFor={`${id}-input`}>Officer name</label>
    <div className="relative"><input id={`${id}-input`} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`}
      aria-activedescendant={open && active >= 0 && options[active] ? `${id}-${active}` : undefined}
      autoComplete="off" className="input pr-10" placeholder="Type a new name or find a profile without a card"
      disabled={disabled} value={value} onFocus={() => setOpen(true)} onChange={e => { onChange(e.target.value); setOpen(true); setActive(-1) }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true)
          setActive(index => options.length ? index < 0 ? event.key === 'ArrowDown' ? 0 : options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : -1)
        } else if (event.key === 'Enter' && open && active >= 0 && options[active]) { event.preventDefault(); choose(options[active]) }
        else if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false) }
      }} /><ChevronDown aria-hidden="true" className={`absolute right-3 top-2.5 w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} /></div>
    {open && !disabled && <div className="absolute top-full mt-1 z-20 w-full rounded-xl border border-slate-600/60 bg-slate-900 shadow-xl p-1.5 animate-fade-in">
      <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500">Existing officers without a card</p>
      <ul id={`${id}-list`} role="listbox" className="max-h-48 overflow-auto">
        {options.map((officer, index) => <li key={officer.card_uid} id={`${id}-${index}`} role="option" aria-selected={active === index}
          className={`rounded-lg px-3 py-2 text-sm cursor-pointer ${active === index ? 'bg-brand-500/20 text-white' : 'text-slate-300 hover:bg-white/5'}`}
          onMouseDown={e => e.preventDefault()} onClick={() => choose(officer)} onMouseEnter={() => setActive(index)}>
          <span className="block">{officer.first_name} {officer.last_name}</span><span className="text-xs text-slate-500">{officer.position}</span>
        </li>)}
      </ul>
      {!options.length && <p className="px-3 py-2 text-xs text-slate-400 flex items-center gap-2"><UserPlus className="w-4 h-4" />{query ? 'New name. Check the first and last names below.' : 'No profiles are waiting for a card.'}</p>}
    </div>}
    <p className="text-xs text-slate-500 mt-1.5">Selecting a profile keeps its logbook history. You can also type a new name.</p>
  </div>
}
