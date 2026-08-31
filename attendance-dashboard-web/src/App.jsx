import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import { Monitor, Users, History, Zap, CalendarDays, Settings, LogOut, ShieldCheck } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import LiveKiosk    from './pages/LiveKiosk'
import OfficerRoster from './pages/OfficerRoster'
import LogHistory   from './pages/LogHistory'
import Calendar     from './pages/Calendar'
import DayConfig    from './pages/DayConfig'
import Login        from './pages/Login'

const PUBLIC_NAV = [
  { to: '/',         label: 'Live Kiosk',     icon: Monitor      },
  { to: '/roster',   label: 'Officer Roster',  icon: Users        },
  { to: '/history',  label: 'Log History',     icon: History      },
  { to: '/calendar', label: 'Calendar',        icon: CalendarDays },
]

const ADMIN_NAV = [
  { to: '/day-config', label: 'Day Config', icon: Settings },
]

function Sidebar() {
  const { user, isAdmin, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/')
  }

  return (
    <aside className="fixed inset-y-0 left-0 w-60 flex flex-col bg-slate-900/80 backdrop-blur-md border-r border-white/10 z-30">
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

      {/* Public nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {PUBLIC_NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
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
              <p className="text-xs text-slate-600 font-semibold uppercase tracking-widest">Admin</p>
            </div>
            {ADMIN_NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
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
                <p className="text-xs text-slate-600">Admin</p>
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
            <span className="text-slate-500">Admin Sign In</span>
          </NavLink>
        )}
        <p className="text-xs text-slate-700 text-center pt-1">NFC Attendance System v2.0</p>
      </div>
    </aside>
  )
}

function AppShell() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-60 p-6 lg:p-8 animate-fade-in">
        <Routes>
          {/* Public routes */}
          <Route path="/"         element={<LiveKiosk />}     />
          <Route path="/roster"   element={<OfficerRoster />} />
          <Route path="/history"  element={<LogHistory />}    />
          <Route path="/calendar" element={<Calendar />}      />

          {/* Admin-only routes */}
          <Route path="/day-config" element={
            <ProtectedRoute><DayConfig /></ProtectedRoute>
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
      <AppShell />
    </AuthProvider>
  )
}
