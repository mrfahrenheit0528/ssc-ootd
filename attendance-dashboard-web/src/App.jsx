import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Routes, Route, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Monitor, Users, History, CalendarDays, Settings, LogOut, ShieldCheck, GraduationCap, Menu, X, BarChart3 } from 'lucide-react'
import councilLogo from './assets/ssc-logo.png'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { SemesterProvider, useSemester } from './contexts/SemesterContext'
import ProtectedRoute from './components/ProtectedRoute'
import LiveKiosk       from './pages/LiveKiosk'
import OfficerRoster  from './pages/OfficerRoster'
import LogHistory     from './pages/LogHistory'
import Calendar       from './pages/Calendar'
import DayConfig      from './pages/DayConfig'
import SemesterManager from './pages/SemesterManager'
import Login          from './pages/Login'

const Analytics = lazy(() => import('./pages/Analytics'))

const MEMBER_NAV = [
  { to: '/',         label: 'Live Kiosk',     icon: Monitor      },
  { to: '/history',  label: 'Log History',     icon: History      },
  { to: '/calendar', label: 'Calendar',        icon: CalendarDays },
  { to: '/analytics', label: 'Analytics',      icon: BarChart3    },
]

const ADMIN_NAV = [
  { to: '/roster',   label: 'Officer Roster', icon: Users          },
  { to: '/day-config',  label: 'Day Config',  icon: Settings       },
  { to: '/semesters',   label: 'Semesters',   icon: GraduationCap  },
]

function Sidebar({open,onClose}) {
  const { user, isAdmin, logout } = useAuth()
  const navigate = useNavigate()
  const drawer = useRef(null)
  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = () => [...drawer.current.querySelectorAll('a[href], button:not(:disabled)')]
    focusable()[0]?.focus({ preventScroll: true })
    const frame = requestAnimationFrame(() => {
      if (!drawer.current.contains(document.activeElement)) focusable()[0]?.focus({ preventScroll: true })
    })
    const keyboard = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key !== 'Tab') return
      const controls = focusable(), first = controls[0], last = controls.at(-1)
      if (!drawer.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    const resize = () => { if (window.innerWidth >= 768) onClose() }
    document.addEventListener('keydown', keyboard)
    window.addEventListener('resize', resize)
    return () => {
      document.body.style.overflow = previousOverflow
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', keyboard)
      window.removeEventListener('resize', resize)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open, onClose])

  const handleLogout = async () => {
    await logout()
    navigate('/')
  }

  return (<>
    {open && <button className="fixed inset-0 bg-black/60 z-20 md:hidden" aria-label="Close navigation" onClick={onClose} />}
    <aside ref={drawer} id="dashboard-navigation" data-open={open} role={open ? 'dialog' : undefined} aria-modal={open || undefined} aria-label="Main navigation" className={`app-sidebar fixed inset-y-0 left-0 w-60 flex flex-col bg-slate-900/95 backdrop-blur-md border-r border-white/10 z-30 transition-transform md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <button className="md:hidden absolute right-1 top-1 min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg" aria-label="Close navigation" onClick={onClose}><X className="w-5 h-5" /></button>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-6 border-b border-white/10">
        <img src={councilLogo} alt="CSPC Supreme Student Council logo" width={1437} height={1570} className="w-12 h-14 shrink-0 object-contain" />
        <div>
          <p className="text-sm font-semibold text-white leading-tight">SSC Attendance</p>
          <p className="text-xs text-slate-500">Council Dashboard</p>
        </div>
      </div>

      {/* Approved member navigation */}
      <nav className="flex-1 min-h-0 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Dashboard pages">
        {MEMBER_NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            onClick={onClose}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </NavLink>
        ))}

        {/* Admin-only nav items */}
        {isAdmin && (
          <>
            <div className="pt-3 pb-1 px-3">
              <p className="text-xs text-slate-600 font-semibold uppercase tracking-widest">{isAdmin ? 'Admin' : 'Officer'}</p>
            </div>
            {ADMIN_NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                onClick={onClose}
                to={to}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* Auth footer */}
      <div className="px-3 py-4 border-t border-white/10 space-y-2">
        {user ? (
          <>
            <div className="flex items-center gap-2 px-3 py-2">
              <ShieldCheck className="w-4 h-4 text-brand-400 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-brand-300 truncate">{user.email}</p>
                <p className="text-xs text-slate-600">{isAdmin ? 'Admin' : 'Officer'}</p>
              </div>
            </div>
            <button
              id="sidebar-logout-btn"
              onClick={handleLogout}
              className="nav-link w-full text-red-400 hover:text-red-300 hover:bg-red-500/10"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </>
        ) : (
          <NavLink
            to="/login"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <ShieldCheck className="w-4 h-4 flex-shrink-0 text-slate-500" />
            <span className="text-slate-500">Sign In</span>
          </NavLink>
        )}
        <p className="text-xs text-slate-700 text-center pt-1">NFC Attendance System v2.0</p>
      </div>
    </aside></>
  )
}

function AppShell() {
  const [navOpen,setNavOpen] = useState(false)
  const closeNavigation = useCallback(() => setNavOpen(false), [])
  const { pathname } = useLocation()
  const pageTitle = [...MEMBER_NAV, ...ADMIN_NAV].find(page => page.to === pathname)?.label || 'Sign In'
  const {error,retry} = useSemester()
  return (
    <div className="flex min-h-screen">
      <Sidebar open={navOpen} onClose={closeNavigation} />
      <main id="main-content" inert={navOpen ? '' : undefined} className="app-main flex-1 min-w-0 md:ml-60 p-4 md:p-6 lg:p-8 animate-fade-in">
        <header className="mobile-topbar md:hidden">
          <img src={councilLogo} alt="SSC" className="h-10 w-10 shrink-0 object-contain" />
          <div className="min-w-0 flex-1"><p className="text-xs text-slate-400">SSC Attendance</p><p className="font-semibold truncate">{pageTitle}</p></div>
          <button className="btn-secondary justify-center" aria-label="Open navigation" aria-controls="dashboard-navigation" aria-expanded={navOpen} onClick={()=>setNavOpen(true)}><Menu className="w-5 h-5" />Menu</button>
        </header>
        {error && <div role="alert" className="card p-4 mb-4 text-red-300">{error}<button className="btn-secondary ml-3" onClick={retry}>Retry semesters</button></div>}
        <Routes>
          {/* Attendance data requires an approved SSC account. */}
          <Route path="/"         element={<ProtectedRoute><LiveKiosk /></ProtectedRoute>}     />
          <Route path="/roster"   element={<ProtectedRoute adminOnly><OfficerRoster /></ProtectedRoute>} />
          <Route path="/history"  element={<ProtectedRoute><LogHistory /></ProtectedRoute>}    />
          <Route path="/calendar" element={<ProtectedRoute><Calendar /></ProtectedRoute>}      />

          <Route path="/analytics" element={
            <ProtectedRoute><Suspense fallback={<p role="status" className="text-sm text-slate-400 animate-pulse">Loading analytics…</p>}><Analytics /></Suspense></ProtectedRoute>
          } />
          {/* Admin-only routes */}
          <Route path="/day-config" element={
            <ProtectedRoute adminOnly><DayConfig /></ProtectedRoute>
          } />
          <Route path="/semesters" element={
            <ProtectedRoute adminOnly><SemesterManager /></ProtectedRoute>
          } />

          {/* Auth */}
          <Route path="/login" element={<Login />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <SemesterProvider>
        <AppShell />
      </SemesterProvider>
    </AuthProvider>
  )
}
