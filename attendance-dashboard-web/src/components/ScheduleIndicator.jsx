import React from 'react'

const SCHEDULES = {
  scheduled: { emoji: '📌', label: 'Scheduled' },
  unscheduled: { emoji: '➖', label: 'Unscheduled' },
}

export function ScheduleIndicator({ type, dayType = 'regular', className = '' }) {
  // Calendar exceptions suspend required duty without removing the saved list.
  const marker = dayType === 'regular' ? SCHEDULES[type] ?? SCHEDULES.unscheduled : SCHEDULES.unscheduled
  return (
    <span role="img" aria-label={marker.label} title={marker.label}
      className={`inline-flex items-center justify-center text-base leading-none ${className}`}>
      {marker.emoji}
    </span>
  )
}

export function ScheduleLegend() {
  return (
    <div aria-label="Schedule legend" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
      {Object.entries(SCHEDULES).map(([type, marker]) => (
        <span key={type} className="inline-flex items-center gap-1.5">
          <ScheduleIndicator type={type} />
          <span>{marker.label}</span>
        </span>
      ))}
    </div>
  )
}
