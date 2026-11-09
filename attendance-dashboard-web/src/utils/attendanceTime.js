export const ATTENDANCE_TIMEZONE = 'Asia/Manila'
export const toDate = value => value?.toDate ? value.toDate() : new Date(value)
export function dateKey(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ATTENDANCE_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(toDate(value))
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-')
}
export function addDateDays(day, days) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
export const weekday = day => new Date(`${dateKey(day)}T12:00:00Z`).getUTCDay()
export const dateBounds = (from, to = from) => ({ from: `${from}T00:00:00+08:00`, until: `${addDateDays(to, 1)}T00:00:00+08:00` })
export function timeInput(value = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: ATTENDANCE_TIMEZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(toDate(value))
}
export const isDayClosed = (day, now = new Date()) => toDate(now).getTime() >= new Date(`${dateKey(day)}T21:00:00+08:00`).getTime()
export function formatTime(value) {
  if (!value || !Number.isFinite(toDate(value).getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', { timeZone: ATTENDANCE_TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(toDate(value))
}
export function formatDuration(a, b) {
  if (!a || !b) return '—'
  const seconds = Math.max(0, Math.floor((toDate(b) - toDate(a)) / 1000))
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(v => String(v).padStart(2, '0')).join(':')
}
