import { lazy, Suspense, useState } from 'react'
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import { Monitor, Users, History, Zap, CalendarDays, Settings, LogOut, ShieldCheck, GraduationCap, Menu, X, BarChart3 } from 'lucide-react'
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

  const handleLogout = async () => {
    await logout()
    navigate('/')
  }

  return (<>
    {open && <button className="fixed inset-0 bg-black/60 z-20 md:hidden" aria-label="Close navigation" onClick={onClose} />}
    <aside className={`fixed inset-y-0 left-0 w-60 flex flex-col bg-slate-900/95 backdrop-blur-md border-r border-white/10 z-30 transition-transform md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <button className="md:hidden absolute right-2 top-2 p-2" aria-label="Close navigation" onClick={onClose}><X className="w-4 h-4" /></button>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-6 border-b border-white/10">
        <div className="w-9 h-9 rounded-xl bg-brand-600/30 border border-brand-500/40 flex items-center justify-center">
          <Zap className="w-5 h-5 text-brand-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white leading-tight">SSC Attendance</p>
          <p className="text-xs text-slate-500">Council Dashboard</p>
        </div>
      </div>

      {/* Approved member navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
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
  const {error,retry} = useSemester()
  return (
    <div className="flex min-h-screen">
      <Sidebar open={navOpen} onClose={()=>setNavOpen(false)} />
      <main className="flex-1 min-w-0 md:ml-60 p-4 md:p-6 lg:p-8 animate-fade-in">
        <button className="btn-secondary mb-4 md:hidden" aria-expanded={navOpen} onClick={()=>setNavOpen(true)}><Menu className="w-4 h-4" />Menu</button>
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
