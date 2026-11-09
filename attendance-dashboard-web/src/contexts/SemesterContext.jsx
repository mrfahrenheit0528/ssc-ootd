import { createContext, useContext, useEffect, useState } from 'react'
import { watchRecords } from '../data'
import { useAuth } from './AuthContext'

const SemesterContext = createContext(null)
export function SemesterProvider({ children }) {
  const { isMember, user } = useAuth()
  const [semesters, setSemesters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,setError] = useState('')
  const [retry,setRetry] = useState(0)
  useEffect(() => {
    if (!isMember) { setSemesters([]); setLoading(false); return }
    setLoading(true);setError('')
    return watchRecords('semesters', { orderBy: 'start_date' }, rows => {
      setError('');setSemesters(rows)
      setLoading(false)
    }, error => { setError('Could not load semesters: '+error.message);setSemesters([]);setLoading(false) })
  }, [isMember, user?.id,retry])
  const activeSemester = semesters.find(s => s.status === 'active') ?? null
  return <SemesterContext.Provider value={{ semesters, activeSemester, loading, error, retry:()=>setRetry(v=>v+1) }}>{children}</SemesterContext.Provider>
}
export const useSemester = () => useContext(SemesterContext)
