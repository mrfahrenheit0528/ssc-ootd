import { useEffect, useRef, useState } from 'react'
import { addDateDays, dateKey } from '../utils/attendanceTime.js'

function semesterScope(semester, today) {
  return semester
    ? { semesterId: semester.id, from: semester.start_date, to: semester.end_date || (semester.start_date > today ? semester.start_date : today) }
    : { semesterId: '', from: today, to: today }
}

export function useHistoryFilters({ semesters, activeSemester, loading, error, load, today = dateKey() }) {
  const [draft, setDraft] = useState(() => semesterScope(activeSemester, today))
  const loadRef = useRef(load)
  loadRef.current = load
  const activeKey = activeSemester ? `${activeSemester.id}|${activeSemester.start_date}|${activeSemester.end_date ?? ''}` : ''
  const publish = next => {
    setDraft(next)
    loadRef.current(next.from, next.to, next.semesterId)
  }
  // Default after metadata arrives and follow a new active term. Ordinary
  // rerenders and intentional archived/date filters do not reset the selection.
  useEffect(() => {
    if (!loading && !error) publish(semesterScope(activeSemester, today))
  }, [activeKey, loading, error])

  const chooseSemester = id => {
    const semester = semesters.find(s => s.id === id)
    if (id && !semester) return
    publish(semesterScope(semester, today))
  }
  const applyPreset = days => {
    const semester = semesters.find(s => s.id === draft.semesterId)
    let from = addDateDays(today, -(days > 1 ? days - 1 : days))
    let to = days === 1 ? from : today
    if (semester) {
      if (from < semester.start_date) from = semester.start_date
      if (semester.end_date && to > semester.end_date) to = semester.end_date
      if (from > to) return false
    }
    publish({ ...draft, from, to })
    return true
  }
  return {
    ...draft, chooseSemester, applyPreset,
    setFrom: from => setDraft(old => ({ ...old, from })),
    setTo: to => setDraft(old => ({ ...old, to })),
  }
}
