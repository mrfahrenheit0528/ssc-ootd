import React from 'react'
import Select from './Select'

export default function AnalyticsPeriodFields({ filters, semester, disabled }) {
  return <>
    <div className="w-full sm:w-44"><label htmlFor="analytics-view" className="label">Analysis view</label><Select id="analytics-view" value={filters.dateMode} disabled={disabled} onChange={event => filters.setDateMode(event.target.value)}><option value="range">Date range</option><option value="day">Single day</option></Select></div>
    {filters.dateMode === 'day'
      ? <div className="flex-1 min-w-40"><label htmlFor="analytics-day" className="label">Date</label><input className="input" type="date" id="analytics-day" required disabled={disabled} min={semester?.start_date} max={semester?.end_date || undefined} value={filters.from} onChange={event => filters.setDay(event.target.value)} /></div>
      : <>
        <div className="flex-1 min-w-40"><label htmlFor="analytics-from" className="label">From</label><input className="input" type="date" id="analytics-from" required disabled={disabled} min={semester?.start_date} max={semester?.end_date || undefined} value={filters.from} onChange={event => filters.setFrom(event.target.value)} /></div>
        <div className="flex-1 min-w-40"><label htmlFor="analytics-to" className="label">To</label><input className="input" type="date" id="analytics-to" required disabled={disabled} min={filters.from || semester?.start_date} max={semester?.end_date || undefined} value={filters.to} onChange={event => filters.setTo(event.target.value)} /></div>
      </>}
  </>
}
