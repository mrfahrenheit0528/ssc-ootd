// src/components/ProtectedRoute.jsx
// ----------------------------------
// Redirects unauthenticated users to /login for admin-only routes.
// Loading state shows a spinner to avoid layout flash.

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Zap } from 'lucide-react'

export default function ProtectedRoute({ children }) {
  const { user, isAdmin, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500 text-sm">Checking permissions…</p>
        </div>
      </div>
    )
  }

  if (!user || !isAdmin) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return children
}
