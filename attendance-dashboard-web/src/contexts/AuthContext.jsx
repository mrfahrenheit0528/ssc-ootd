import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { clearPhotoCache } from '../data'

const AuthContext = createContext(null)
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  useEffect(() => {
    let generation = 0
    let stopped = false
    let previousId = null
    let roleChannel = null
    const apply = async session => {
      const current = ++generation
      const u = session?.user ?? null
      setUser(u)
      setAuthError('')
      if ((u?.id ?? null) !== previousId) {
        setRole(null)
        setLoading(true)
        clearPhotoCache()
        if (roleChannel) supabase.removeChannel(roleChannel)
        roleChannel = null
        previousId = u?.id ?? null
        if (u) roleChannel = supabase.channel(`ssc-role-${u.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'user_roles', filter: `user_id=eq.${u.id}` }, () => apply(session))
          .subscribe()
      }
      if (u) {
        const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', u.id).maybeSingle()
        if (stopped || current !== generation) return
        setRole(data?.role ?? null)
        if (error) setAuthError('Could not check account permissions. Please sign in again.')
        else if (!data) setAuthError('Your account needs an SSC officer or admin role. Contact your administrator.')
      }
      if (!stopped && current === generation) setLoading(false)
    }
    // Database calls must run outside the Supabase auth callback lock.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => { if (!stopped) apply(session) }, 0)
    })
    return () => {
      stopped = true
      generation++
      subscription.unsubscribe()
      if (roleChannel) supabase.removeChannel(roleChannel)
    }
  }, [])
  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }
  const logout = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    clearPhotoCache()
    setUser(null)
    setRole(null)
  }
  return <AuthContext.Provider value={{ user, role, isAdmin: role === 'admin', isMember: role === 'admin' || role === 'officer', loading, authError, login, logout }}>{children}</AuthContext.Provider>
}
export const useAuth = () => useContext(AuthContext)
