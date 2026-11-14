import { useCallback, useState } from 'react'
import { emptyWeek } from '../utils/attendance.js'

const copyWeek = schedule => Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, {
  type: schedule[day]?.type ?? 'unscheduled', required_uids: [...(schedule[day]?.required_uids ?? [])],
}]))
const signature = schedule => JSON.stringify(Array.from({ length: 7 }, (_, day) => [
  schedule[day].type, [...new Set(schedule[day].required_uids)].sort(),
]))

export function useWeeklyScheduleDraft({ readOnly = false, saving = false } = {}) {
  const [state, setState] = useState(() => ({ saved: emptyWeek(), draft: emptyWeek(), editing: false, scope: 'today_onward' }))
  const resetSchedule = useCallback(schedule => {
    setState({ saved: copyWeek(schedule), draft: copyWeek(schedule), editing: false, scope: 'today_onward' })
  }, [])
  const beginEditing = (scope = 'today_onward') => {
    if (!readOnly && !saving) setState(current => ({ ...current, editing: true, scope: scope === 'whole_semester' ? scope : 'today_onward' }))
  }
  const cancelEditing = () => {
    if (!saving) setState(current => ({ ...current, draft: copyWeek(current.saved), editing: false, scope: 'today_onward' }))
  }
  const updateDay = (day, patch) => {
    if (readOnly || saving) return
    setState(current => current.editing ? { ...current, draft: {
      ...current.draft, [day]: { ...current.draft[day], ...patch },
    } } : current)
  }
  const setScope = scope => {
    if (readOnly || saving || !['today_onward', 'whole_semester'].includes(scope)) return
    setState(current => current.editing ? { ...current, scope } : current)
  }
  return {
    schedule: state.draft, editing: state.editing && !readOnly, scope: state.scope,
    dirty: signature(state.draft) !== signature(state.saved) || (state.editing && state.scope === 'whole_semester'),
    resetSchedule, beginEditing, cancelEditing, updateDay, setScope,
  }
}
