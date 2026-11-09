import { createContext, useContext, useEffect, useState } from 'react'
import { watchRecords } from '../data'
import { useAuth } from './AuthContext'

const SemesterContext = createContext(null)
export function SemesterProvider({ children }) {
  const { isMember, user } = useAuth()
  const [semesters, setSemesters] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!isMember) { setSemesters([]); setLoading(false); return }
    setLoading(true)
    return watchRecords('semesters', { orderBy: 'start_date' }, rows => {
      setSemesters(rows)
      setLoading(false)
    }, error => { console.error(error); setLoading(false) })
  }, [isMember, user?.id])
  const activeSemester = semesters.find(s => s.status === 'active') ?? null
  return <SemesterContext.Provider value={{ semesters, activeSemester, loading }}>{children}</SemesterContext.Provider>
}
export const useSemester = () => useContext(SemesterContext)
