import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { Monitor, Users, History, Zap } from 'lucide-react'
import LiveKiosk from './pages/LiveKiosk'
import OfficerRoster from './pages/OfficerRoster'
import LogHistory from './pages/LogHistory'

const NAV = [
  { to: '/',        label: 'Live Kiosk',     icon: Monitor  },
  { to: '/roster',  label: 'Officer Roster',  icon: Users    },
  { to: '/history', label: 'Log History',     icon: History  },
]

function Sidebar() {
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

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `nav-link ${isActive ? 'active' : ''}`
            }
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10">
        <p className="text-xs text-slate-600 text-center">
          NFC Attendance System v1.0
        </p>
      </div>
    </aside>
  )
}

export default function App() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-60 p-6 lg:p-8 animate-fade-in">
        <Routes>
          <Route path="/"        element={<LiveKiosk />} />
          <Route path="/roster"  element={<OfficerRoster />} />
          <Route path="/history" element={<LogHistory />} />
        </Routes>
      </main>
    </div>
  )
}
