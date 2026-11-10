import React, { useId, useRef } from 'react'

export default function Tabs({ label, tabs, value, onValueChange }) {
  const prefix = useId()
  const buttons = useRef(new Map())
  const handleKeyDown = (event, index) => {
    let next
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    onValueChange(tabs[next].value)
    buttons.current.get(tabs[next].value)?.focus()
  }
  return <div className="space-y-4">
    <div role="tablist" aria-label={label} className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-slate-900/70 p-1">
      {tabs.map((tab,index) => {
        const selected = tab.value === value
        return <button key={tab.value} type="button" role="tab" id={`${prefix}-tab-${tab.value}`}
          aria-selected={selected} aria-controls={`${prefix}-panel-${tab.value}`} tabIndex={selected ? 0 : -1}
          ref={node => { if (node) buttons.current.set(tab.value,node); else buttons.current.delete(tab.value) }}
          onClick={() => onValueChange(tab.value)} onKeyDown={event => handleKeyDown(event,index)}
          className={`flex min-w-0 items-center justify-center gap-2 rounded-lg border px-3 py-3 text-xs font-medium transition-all duration-150 sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${selected ? 'border-brand-500/30 bg-brand-500/15 text-brand-200 shadow-sm' : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-100'}`}>
          {tab.icon && <tab.icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />}
          <span>{tab.label}</span>
          {tab.badge && <span title={tab.badge} className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
            <span className="sr-only sm:not-sr-only">{tab.badge}</span>
            <span aria-hidden="true" className="block h-1.5 w-1.5 rounded-full bg-amber-400 sm:hidden" />
          </span>}
        </button>
      })}
    </div>
    {tabs.map(tab => <div key={tab.value} role="tabpanel" id={`${prefix}-panel-${tab.value}`}
      aria-labelledby={`${prefix}-tab-${tab.value}`} hidden={tab.value !== value} tabIndex={0}
      className={tab.value === value ? 'animate-fade-in' : undefined}>
      {tab.content}
    </div>)}
  </div>
}
