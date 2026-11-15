import { useEffect, useId, useRef } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'

// Desktop keeps the original card/spacing. On phones the same controls can be
// tucked away without unmounting inputs or losing an in-progress selection.
export default function MobileFilterPanel({ title, summary, collapsed, onCollapsedChange, children, className = '' }) {
  const id = useId(), toggle = useRef(null), body = useRef(null)
  useEffect(() => {
    if (collapsed && window.innerWidth < 768 && body.current?.contains(document.activeElement)) toggle.current?.focus({ preventScroll: true })
  }, [collapsed])
  return <div className={`mobile-filter-panel ${className}`} data-collapsed={collapsed}>
    <button ref={toggle} type="button" className="mobile-filter-toggle md:hidden" aria-expanded={!collapsed} aria-controls={id}
      aria-label={`${collapsed ? 'Show' : 'Hide'} ${title.toLowerCase()}`} onClick={() => onCollapsedChange(!collapsed)}>
      <SlidersHorizontal className="w-4 h-4 shrink-0 text-brand-300" />
      <span className="min-w-0 flex-1 text-left"><span className="block font-semibold text-slate-200">{title}</span><span className="block text-xs text-slate-400 truncate">{summary}</span></span>
      <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
    </button>
    <div ref={body} id={id} className="mobile-filter-body space-y-4" data-collapsed={collapsed}>{children}</div>
  </div>
}
