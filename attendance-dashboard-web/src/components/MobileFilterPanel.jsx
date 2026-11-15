import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'

// Desktop keeps the original card/spacing. On phones the same controls can be
// tucked away without unmounting inputs or losing an in-progress selection.
export default function MobileFilterPanel({ title, summary, collapsed, onCollapsedChange, children, className = '' }) {
  const id = useId(), toggle = useRef(null), body = useRef(null)
  const [mobile, setMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const resize = () => setMobile(window.innerWidth < 768)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    if (collapsed && mobile && (body.current?.contains(document.activeElement) || document.activeElement === document.body)) toggle.current?.focus({ preventScroll: true })
  }, [collapsed, mobile])
  return <div className={`mobile-filter-panel ${className}`} data-collapsed={collapsed}>
    <button ref={toggle} type="button" className="mobile-filter-toggle md:hidden" aria-expanded={!collapsed} aria-controls={id}
      aria-label={`${collapsed ? 'Show' : 'Hide'} ${title.toLowerCase()}`} onClick={() => onCollapsedChange(!collapsed)}>
      <SlidersHorizontal className="w-4 h-4 shrink-0 text-brand-300" />
      <span className="min-w-0 flex-1 text-left"><span className="block font-semibold text-slate-200">{title}</span><span className="block text-xs text-slate-400 truncate">{summary}</span></span>
      <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
    </button>
    <div ref={body} id={id} className="mobile-filter-body" data-collapsed={collapsed} inert={collapsed && mobile ? '' : undefined}>
      <div className="mobile-filter-inner space-y-4">{children}</div>
    </div>
  </div>
}
