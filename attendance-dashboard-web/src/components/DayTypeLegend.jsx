import { DAY_TYPE_LABELS } from '../utils/attendance'

const DAY_TYPES = [
  { type: 'regular', color: 'bg-emerald-400' },
  { type: 'no_classes', color: 'bg-red-400' },
  { type: 'optional', color: 'bg-blue-400' },
]

export default function DayTypeLegend() {
  return (
    <div aria-label="Day type colors" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
      {DAY_TYPES.map(({ type, color }) => (
        <span key={type} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${color}`} />
          {DAY_TYPE_LABELS[type]}
        </span>
      ))}
    </div>
  )
}
