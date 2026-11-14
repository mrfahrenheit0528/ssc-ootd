import { useCallback, useState } from 'react'
import { emptyWeek } from '../utils/attendance.js'

const copyWeek = schedule => Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, {
  type: schedule[day]?.type ?? 'unscheduled', required_uids: [...(schedule[day]?.required_uids ?? [])],
}]))
const signature = schedule => JSON.stringify(Array.from({ length: 7 }, (_, day) => [
  schedule[day].type, [...new Set(schedule[day].required_uids)].sort(),
]))

export function useWeeklyScheduleDraft({ readOnly = false, saving = false } = {}) {
  const [state, setState] = useState(() => ({ saved: emptyWeek(), draft: emptyWeek(), editing: false }))
  const resetSchedule = useCallback(schedule => {
    setState({ saved: copyWeek(schedule), draft: copyWeek(schedule), editing: false })
  }, [])
  const beginEditing = () => {
    if (!readOnly && !saving) setState(current => ({ ...current, editing: true }))
  }
  const cancelEditing = () => {
    if (!saving) setState(current => ({ ...current, draft: copyWeek(current.saved), editing: false }))
  }
  const updateDay = (day, patch) => {
    if (readOnly || saving) return
    setState(current => current.editing ? { ...current, draft: {
      ...current.draft, [day]: { ...current.draft[day], ...patch },
    } } : current)
  }
  return {
    schedule: state.draft, editing: state.editing && !readOnly,
    dirty: signature(state.draft) !== signature(state.saved),
    resetSchedule, beginEditing, cancelEditing, updateDay,
  }
}
