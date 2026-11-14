import { useEffect, useRef, useState } from 'react'
import { addDateDays, dateKey } from '../utils/attendanceTime.js'

function semesterScope(semester, today, dateMode = 'range') {
  if (dateMode === 'day') {
    const day = semester && today < semester.start_date ? semester.start_date
      : semester?.end_date && today > semester.end_date ? semester.end_date : today
    return { semesterId: semester?.id ?? '', from: day, to: day, dateMode }
  }
  return semester
    ? { semesterId: semester.id, from: semester.start_date, to: semester.end_date || (semester.start_date > today ? semester.start_date : today), dateMode }
    : { semesterId: '', from: today, to: today, dateMode }
}

export function useHistoryFilters({ semesters, activeSemester, loading, error, load, today = dateKey(), allowSingleDay = false }) {
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
    if (!loading && !error) publish(semesterScope(activeSemester, today, draft.dateMode))
  }, [activeKey, loading, error])

  const chooseSemester = id => {
    const semester = semesters.find(s => s.id === id)
    if (id && !semester) return
    publish(semesterScope(semester, today, draft.dateMode))
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
    publish({ ...draft, from, to, dateMode: allowSingleDay && days <= 1 ? 'day' : 'range' })
    return true
  }
  return {
    ...draft, chooseSemester, applyPreset,
    setDateMode: dateMode => {
      if (!allowSingleDay || !['day', 'range'].includes(dateMode)) return
      setDraft(old => {
        if (dateMode === 'range') return { ...old, dateMode }
        const anchor = old.to && old.to < today ? old.to : today
        const day = semesterScope(semesters.find(semester => semester.id === old.semesterId), anchor, 'day').from
        return { ...old, dateMode, from: day, to: day }
      })
    },
    setDay: day => {
      if (allowSingleDay) setDraft(old => ({ ...old, from: day, to: day, dateMode: 'day' }))
    },
    setFrom: from => setDraft(old => ({ ...old, from })),
    setTo: to => setDraft(old => ({ ...old, to })),
  }
}
