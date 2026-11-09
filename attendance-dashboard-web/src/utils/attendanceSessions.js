import { format } from 'date-fns'

function eventDate(event) {
  return event.timestamp?.toDate ? event.timestamp.toDate() : new Date(event.timestamp)
}

// Pair events only within the same officer and calendar day. Keep incomplete
// sessions visible so missing or manually removed events are not hidden.
export function buildAttendanceSessions(logs) {
  const chronological = [...logs].sort((a, b) => eventDate(a) - eventDate(b))
  const open = new Map()
  const sessions = []
  for (const log of chronological) {
    const date = format(eventDate(log), 'yyyy-MM-dd')
    const key = JSON.stringify([log.card_uid, date])
    if (log.type === 'CLOCK_IN') {
      const session = { date, card_uid: log.card_uid, officer_name: log.officer_name, clockIn: log, clockOut: null }
      open.set(key, session)
      sessions.push(session)
    } else if (log.type === 'CLOCK_OUT') {
      const session = open.get(key)
      if (session) {
        session.clockOut = log
        open.delete(key)
      } else {
        sessions.push({ date, card_uid: log.card_uid, officer_name: log.officer_name, clockIn: null, clockOut: log })
      }
    }
  }
  return sessions.sort((a, b) => eventDate(b.clockOut ?? b.clockIn) - eventDate(a.clockOut ?? a.clockIn))
}

export function filterAttendanceSessions(sessions, search) {
  const query = search.trim().toLowerCase()
  if (!query) return sessions
  return sessions.filter(session => [session.clockIn, session.clockOut].some(log => log &&
    [log.officer_name, log.card_uid, log.type, log.type?.replaceAll('_', ' ')]
      .some(value => value?.toLowerCase().includes(query))))
}
