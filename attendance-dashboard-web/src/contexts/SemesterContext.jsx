// src/contexts/SemesterContext.jsx
// ---------------------------------
// Global semester state. Provides activeSemester + all semesters to the whole app.
// Firestore collection: semesters/{id} → { name, start_date, end_date, status, officer_snapshot }

import { createContext, useContext, useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from './AuthContext'

const SemesterContext = createContext(null)

export function SemesterProvider({ children }) {
  const { isAdmin, user } = useAuth()
  const [semesters, setSemesters] = useState([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    if (!isAdmin) {
      setSemesters([])
      setLoading(false)
      return
    }
    setLoading(true)
    const q = query(collection(db, 'semesters'), orderBy('start_date', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      setSemesters(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => setLoading(false))
    return () => unsub()
  }, [isAdmin, user?.uid])

  const activeSemester = semesters.find(s => s.status === 'active') ?? null

  return (
    <SemesterContext.Provider value={{ semesters, activeSemester, loading }}>
      {children}
    </SemesterContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useSemester = () => useContext(SemesterContext)
