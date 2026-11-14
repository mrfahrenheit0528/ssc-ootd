import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export default function DirectoryGroupCombobox({ value, groups, label, disabled, onChange }) {
  const id = useId(), root = useRef(null), input = useRef(null), menu = useRef(null)
  const [open,setOpen] = useState(false), [filtering,setFiltering] = useState(false), [active,setActive] = useState(-1)
  const [bounds,setBounds] = useState(null)
  const seen = new Set()
  const options = groups.map(group=>group.trim()).filter(group=>{
    const key=group.toLowerCase()
    if (!group || seen.has(key)) return false
    seen.add(key)
    return !filtering || key.includes(value.trim().toLowerCase())
  })
  useLayoutEffect(()=>{
    if (!open || disabled) return
    const position = () => {
      const rect=root.current.getBoundingClientRect(), height=Math.min(224,window.innerHeight-24)
      const width=Math.min(Math.max(rect.width,220),window.innerWidth-24)
      const below=window.innerHeight-rect.bottom-12, above=rect.top-12
      const placeAbove=below<Math.min(height,120) && above>below
      const maxHeight=Math.max(48,Math.min(height,placeAbove ? above-6 : below-6))
      setBounds({left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),width,maxHeight,
        ...(placeAbove ? {bottom:window.innerHeight-rect.top+6} : {top:rect.bottom+6})})
    }
    position()
    const dismiss=event=>{if(!root.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false)}
    window.addEventListener('resize',position)
    window.addEventListener('scroll',position,true)
    document.addEventListener('pointerdown',dismiss)
    return()=>{window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);document.removeEventListener('pointerdown',dismiss)}
  },[open,disabled])
  useEffect(()=>{if(open && active>=0) document.getElementById(`${id}-group-${active}`)?.scrollIntoView({block:'nearest'})},[open,active,id])
  const choose=group=>{onChange(group);setOpen(false);setActive(-1);setFiltering(false)}
  const closeOnBlur=event=>{
    if (!root.current?.contains(event.relatedTarget) && !menu.current?.contains(event.relatedTarget)) {
      setOpen(false);setActive(-1)
      if(value!==value.trim()) onChange(value.trim())
    }
  }
  return <div ref={root} className="relative min-w-36" onBlur={closeOnBlur}>
    <input ref={input} aria-label={label} role="combobox" aria-autocomplete="list" aria-expanded={open && !disabled}
      aria-controls={open && !disabled ? `${id}-groups` : undefined}
      aria-activedescendant={open && !disabled && options[active] ? `${id}-group-${active}` : undefined}
      className="input pr-9" autoComplete="off" maxLength={100} placeholder="Choose or type a group" value={value} disabled={disabled}
      onFocus={()=>{setOpen(true);setFiltering(false);setActive(-1)}}
      onClick={()=>setOpen(true)}
      onChange={event=>{onChange(event.target.value);setFiltering(true);setOpen(true);setActive(-1)}}
      onKeyDown={event=>{
        if(event.key==='ArrowDown' || event.key==='ArrowUp') {
          event.preventDefault();setOpen(true)
          setActive(index=>options.length ? index<0 ? event.key==='ArrowDown' ? 0 : options.length-1 : (index+(event.key==='ArrowDown' ? 1 : -1)+options.length)%options.length : -1)
        } else if(event.key==='Enter' && open && (options[active] || value.trim())) {event.preventDefault();choose(options[active] || value.trim())}
        else if(event.key==='Escape' && open) {event.preventDefault();setOpen(false);setActive(-1)}
      }} />
    <button type="button" tabIndex={-1} aria-label={`Show groups for ${label.toLowerCase()}`} disabled={disabled} aria-expanded={open && !disabled}
      className="absolute right-1 top-1 bottom-1 px-2 rounded-lg text-slate-400 hover:text-slate-200 disabled:opacity-40"
      onMouseDown={event=>event.preventDefault()} onClick={()=>{input.current.focus();setFiltering(false);setActive(-1);setOpen(!open)}}>
      <ChevronDown aria-hidden="true" className={`w-4 h-4 transition-transform ${open && !disabled ? 'rotate-180' : ''}`} />
    </button>
    {open && !disabled && bounds && createPortal(<div ref={menu} className="fixed z-[80] overflow-y-auto rounded-xl border border-white/15 bg-slate-900 p-1.5 shadow-2xl animate-fade-in" style={bounds}>
      <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500">Reuse a directory group</p>
      <ul id={`${id}-groups`} role="listbox" aria-label={`${label} suggestions`}>
        {options.map((group,index)=><li key={group} id={`${id}-group-${index}`} role="option" aria-selected={value.trim().toLowerCase()===group.toLowerCase()}
          className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer ${active===index ? 'bg-brand-500/20 text-white' : 'text-slate-300 hover:bg-white/5'}`}
          onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActive(index)} onClick={()=>choose(group)}>
          <span>{group}</span>{value.trim().toLowerCase()===group.toLowerCase() && <Check aria-hidden="true" className="w-4 h-4 text-brand-300" />}
        </li>)}
      </ul>
      <p className="px-3 py-2 text-xs text-slate-500">{!options.length ? 'Type a new group name to use it here.' : 'Or type a new group name in the field.'}</p>
    </div>,document.body)}
  </div>
}
