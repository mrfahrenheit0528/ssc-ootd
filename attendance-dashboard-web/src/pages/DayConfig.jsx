// pages/DayConfig.jsx
// -------------------
// Admin page for day configuration.
//
// Firestore schema (updated):
//   day_config/weekly        → { schedule: { '0': {...}, '1': {...}, ... }, effective_from: 'YYYY-MM-DD' }
//     - schedule[dayOfWeek]: { type, required_uids, note }
//     - effective_from: recurring rules only apply ON OR AFTER this date (past records untouched)
//     - Default built-in: Sunday (0) = no_classes, Saturday (6) = no_classes, others = regular
//
//   day_config/{YYYY-MM-DD}  → { type, note, required_uids }  (specific date, highest priority)

import { useState, useEffect } from 'react'
import { collection, doc, getDoc, setDoc, getDocs, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { Settings, Save, Plus, Trash2, X, Info, ChevronDown, ChevronUp, CalendarDays, RotateCcw } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────
const DAY_TYPES = [
  { value: 'regular',    label: '📅 Regular',     desc: 'Normal school day, attendance required' },
  { value: 'holiday',    label: '🎉 Holiday',     desc: 'No attendance required' },
  { value: 'no_classes', label: '📚 No Classes',  desc: 'School open, no classes (e.g. faculty seminar)' },
  { value: 'optional',   label: '🔵 Optional',    desc: 'Attendance encouraged but not mandatory' },
]

const DAYS_OF_WEEK = [
  { idx: 0, short: 'SUN', full: 'Sunday' },
  { idx: 1, short: 'MON', full: 'Monday' },
  { idx: 2, short: 'TUE', full: 'Tuesday' },
  { idx: 3, short: 'WED', full: 'Wednesday' },
  { idx: 4, short: 'THU', full: 'Thursday' },
  { idx: 5, short: 'FRI', full: 'Friday' },
  { idx: 6, short: 'SAT', full: 'Saturday' },
]

// Built-in defaults (before any weekly schedule is configured)
const BUILTIN_DEFAULTS = {
  0: { type: 'no_classes', required_uids: [] },
  1: { type: 'regular',    required_uids: [] },
  2: { type: 'regular',    required_uids: [] },
  3: { type: 'regular',    required_uids: [] },
  4: { type: 'regular',    required_uids: [] },
  5: { type: 'regular',    required_uids: [] },
  6: { type: 'no_classes', required_uids: [] },
}

// ── Officer multi-select for a single day row ─────────────────────────────────
function DayOfficerPicker({ dayIdx, schedule, setSchedule, officers }) {
  const [open, setOpen] = useState(false)
  const day        = schedule[dayIdx] ?? BUILTIN_DEFAULTS[dayIdx]
  const selected   = day.required_uids ?? []
  const isNoAttend = day.type === 'holiday' || day.type === 'no_classes'

  const toggleOfficer = (uid) => {
    setSchedule(prev => {
      const cur = prev[dayIdx] ?? BUILTIN_DEFAULTS[dayIdx]
      const uids = cur.required_uids ?? []
      return {
        ...prev,
        [dayIdx]: {
          ...cur,
          required_uids: uids.includes(uid) ? uids.filter(u => u !== uid) : [...uids, uid],
        },
      }
    })
  }

  const setType = (type) => {
    setSchedule(prev => ({
      ...prev,
      [dayIdx]: { ...(prev[dayIdx] ?? BUILTIN_DEFAULTS[dayIdx]), type },
    }))
    if (open && (type === 'holiday' || type === 'no_classes')) setOpen(false)
  }

  return (
    <div className={`rounded-xl border transition-colors duration-150 overflow-hidden
      ${open ? 'border-brand-500/40 bg-brand-500/5' : 'border-white/8 bg-white/2 hover:border-white/15'}`}>

      {/* Row header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Day badge */}
        <span className={`w-10 text-center text-xs font-bold rounded-lg py-1
          ${dayIdx === 0 || dayIdx === 6 ? 'bg-slate-700/60 text-slate-400' : 'bg-brand-500/15 text-brand-300'}`}>
          {DAYS_OF_WEEK[dayIdx].short}
        </span>

        {/* Day type selector */}
        <select
          className="input py-1.5 text-sm flex-shrink-0 w-40"
          value={day.type}
          onChange={e => setType(e.target.value)}
        >
          {DAY_TYPES.map(dt => (
            <option key={dt.value} value={dt.value}>{dt.label}</option>
          ))}
        </select>

        {/* Officer summary / expand button */}
        {isNoAttend ? (
          <span className="flex-1 text-xs text-slate-600 italic">No attendance required</span>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="flex-1 flex items-center justify-between gap-2 text-sm text-left hover:text-slate-100 transition-colors"
          >
            <span className={selected.length > 0 ? 'text-slate-200' : 'text-slate-500'}>
              {selected.length > 0
                ? `${selected.length} officer${selected.length !== 1 ? 's' : ''} required`
                : 'No required officers set'}
            </span>
            {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
          </button>
        )}
      </div>

      {/* Expanded officer checkboxes */}
      {open && !isNoAttend && (
        <div className="px-4 pb-4 border-t border-white/8">
          {officers.length === 0 ? (
            <p className="text-xs text-slate-500 py-3">No officers enrolled yet.</p>
          ) : (
            <>
              <div className="flex items-center justify-between pt-3 pb-2">
                <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Select required officers</p>
                <div className="flex gap-2">
                  <button type="button" className="text-xs text-brand-400 hover:text-brand-300"
                    onClick={() => setSchedule(prev => ({
                      ...prev,
                      [dayIdx]: { ...(prev[dayIdx] ?? BUILTIN_DEFAULTS[dayIdx]), required_uids: officers.map(o => o.card_uid) }
                    }))}>All</button>
                  <span className="text-slate-700">·</span>
                  <button type="button" className="text-xs text-slate-400 hover:text-slate-200"
                    onClick={() => setSchedule(prev => ({
                      ...prev,
                      [dayIdx]: { ...(prev[dayIdx] ?? BUILTIN_DEFAULTS[dayIdx]), required_uids: [] }
                    }))}>None</button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {officers.map(o => (
                  <label key={o.card_uid} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer border transition-colors
                    ${selected.includes(o.card_uid) ? 'bg-brand-500/10 border-brand-500/25' : 'border-transparent hover:bg-white/5'}`}>
                    <input
                      type="checkbox"
                      checked={selected.includes(o.card_uid)}
                      onChange={() => toggleOfficer(o.card_uid)}
                      className="accent-indigo-500 flex-shrink-0"
                    />
                    <span className="text-sm text-slate-200 truncate">{o.first_name} {o.last_name}</span>
                    <span className="text-xs text-slate-500 ml-auto flex-shrink-0">{o.position}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Specific Date Override Modal ──────────────────────────────────────────────
function DayOverrideModal({ existing, allOfficers, weeklySchedule, onClose, onSave }) {
  const [date,         setDate]         = useState(existing?.date ?? format(new Date(), 'yyyy-MM-dd'))
  const [type,         setType]         = useState(existing?.type ?? 'regular')
  const [note,         setNote]         = useState(existing?.note ?? '')
  const [useCustomReq, setUseCustomReq] = useState(Boolean(existing?.required_uids))
  // Seed custom required from the weekly schedule for that day if no existing override
  const seedUids = () => {
    if (existing?.required_uids) return existing.required_uids
    const dow = new Date(date + 'T12:00:00').getDay()
    return weeklySchedule[dow]?.required_uids ?? []
  }
  const [customReq, setCustomReq] = useState(seedUids)
  const [saving,    setSaving]    = useState(false)

  const toggleOfficer = (uid) => {
    setCustomReq(prev => prev.includes(uid) ? prev.filter(u => u !== uid) : [...prev, uid])
  }

  const handleSave = async () => {
    if (!date) return toast.error('Date is required.')
    setSaving(true)
    try {
      const payload = {
        type,
        note: note.trim(),
        ...(useCustomReq ? { required_uids: customReq } : {}),
        updated_at: new Date(),
      }
      await setDoc(doc(db, 'day_config', date), payload, { merge: true })
      toast.success(`Override saved for ${format(parseISO(date), 'MMM d, yyyy')}.`)
      onSave()
    } catch (err) {
      toast.error('Save failed: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="card w-full max-w-lg p-6 space-y-5 animate-slide-up max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-white text-lg">{existing ? 'Edit Override' : 'Add Specific Date Override'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div>
          <label className="label">Date</label>
          <input id="day-override-date" type="date" className="input"
            value={date} onChange={e => setDate(e.target.value)} disabled={Boolean(existing)} />
        </div>

        <div>
          <label className="label">Day Type</label>
          <div className="space-y-2">
            {DAY_TYPES.map(dt => (
              <label key={dt.value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors
                ${type === dt.value ? 'bg-brand-500/10 border-brand-500/40' : 'bg-white/3 border-white/10 hover:bg-white/5'}`}>
                <input type="radio" name="day-type" value={dt.value}
                  checked={type === dt.value} onChange={() => setType(dt.value)} className="mt-0.5 accent-indigo-500" />
                <div>
                  <p className="text-sm font-medium text-slate-100">{dt.label}</p>
                  <p className="text-xs text-slate-500">{dt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Note <span className="normal-case text-slate-600">(optional)</span></label>
          <input id="day-override-note" className="input" placeholder="e.g. Intramurals, Faculty seminar…"
            value={note} onChange={e => setNote(e.target.value)} />
        </div>

        <div>
          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <input type="checkbox" checked={useCustomReq} onChange={e => setUseCustomReq(e.target.checked)} className="accent-indigo-500" />
            <span className="text-sm text-slate-300">Override required officers for this date</span>
          </label>
          {useCustomReq && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto p-1">
              {allOfficers.length === 0
                ? <p className="text-xs text-slate-500">No officers enrolled yet.</p>
                : allOfficers.map(o => (
                    <label key={o.card_uid} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer border transition-colors
                      ${customReq.includes(o.card_uid) ? 'bg-brand-500/10 border-brand-500/30' : 'border-transparent hover:bg-white/5'}`}>
                      <input type="checkbox" checked={customReq.includes(o.card_uid)}
                        onChange={() => toggleOfficer(o.card_uid)} className="accent-indigo-500" />
                      <span className="text-sm text-slate-200">{o.first_name} {o.last_name}</span>
                      <span className="text-xs text-slate-500 ml-auto">{o.position}</span>
                    </label>
                  ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── DayConfig Page ────────────────────────────────────────────────────────────
export default function DayConfig() {
  const [officers,      setOfficers]      = useState([])
  const [overrides,     setOverrides]     = useState([])
  const [loading,       setLoading]       = useState(true)
  const [savingWeekly,  setSavingWeekly]  = useState(false)
  const [modal,         setModal]         = useState(null)

  // Weekly schedule state
  const [schedule,       setSchedule]       = useState({ ...BUILTIN_DEFAULTS })
  const [effectiveFrom,  setEffectiveFrom]  = useState(format(new Date(), 'yyyy-MM-dd'))

  useEffect(() => {
    const fetchAll = async () => {
      const [officersSnap, weeklySnap, configSnap] = await Promise.all([
        getDocs(collection(db, 'officers')),
        getDoc(doc(db, 'day_config', 'weekly')),
        getDocs(collection(db, 'day_config')),
      ])

      setOfficers(officersSnap.docs.map(d => ({ card_uid: d.id, ...d.data() })))

      if (weeklySnap.exists()) {
        const data = weeklySnap.data()
        // Merge saved schedule with built-in defaults to fill any missing days
        const merged = { ...BUILTIN_DEFAULTS }
        if (data.schedule) {
          Object.entries(data.schedule).forEach(([k, v]) => { merged[Number(k)] = v })
        }
        setSchedule(merged)
        if (data.effective_from) setEffectiveFrom(data.effective_from)
      }

      const ovrs = configSnap.docs
        .filter(d => d.id !== 'weekly' && d.id !== 'defaults')
        .map(d => ({ date: d.id, ...d.data() }))
        .sort((a, b) => a.date.localeCompare(b.date))
      setOverrides(ovrs)
      setLoading(false)
    }
    fetchAll().catch(() => setLoading(false))
  }, [])

  const saveWeeklySchedule = async () => {
    setSavingWeekly(true)
    try {
      // Convert numeric keys to string keys for Firestore
      const schedulePayload = {}
      Object.entries(schedule).forEach(([k, v]) => { schedulePayload[String(k)] = v })

      await setDoc(doc(db, 'day_config', 'weekly'), {
        schedule: schedulePayload,
        effective_from: effectiveFrom,
        updated_at: new Date(),
      })
      toast.success('Weekly schedule saved. Applied from ' + format(parseISO(effectiveFrom), 'MMM d, yyyy') + ' onwards.')
    } catch (err) {
      toast.error('Save failed: ' + err.message)
    } finally {
      setSavingWeekly(false)
    }
  }

  const resetToBuiltinDefaults = () => {
    if (!window.confirm('Reset weekly schedule to system defaults (Sun & Sat = No Classes, all others = Regular)?')) return
    setSchedule({ ...BUILTIN_DEFAULTS })
  }

  const deleteOverride = async (date) => {
    if (!window.confirm(`Delete override for ${format(parseISO(date), 'MMM d, yyyy')}?`)) return
    try {
      await deleteDoc(doc(db, 'day_config', date))
      setOverrides(prev => prev.filter(o => o.date !== date))
      toast.success('Override deleted.')
    } catch (err) {
      toast.error('Delete failed: ' + err.message)
    }
  }

  const refreshOverrides = async () => {
    const snap = await getDocs(collection(db, 'day_config'))
    const ovrs = snap.docs
      .filter(d => d.id !== 'weekly' && d.id !== 'defaults')
      .map(d => ({ date: d.id, ...d.data() }))
      .sort((a, b) => a.date.localeCompare(b.date))
    setOverrides(ovrs)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mr-3" />Loading…
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-slide-up max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Settings className="w-6 h-6 text-brand-400" />
          Day Configuration
        </h1>
        <p className="text-slate-400 mt-1 text-sm">
          Set the weekly attendance schedule and configure special date overrides.
        </p>
      </div>

      {/* ── Section A: Weekly Schedule ─────────────────────────────────────── */}
      <div className="card p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-white flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-brand-400" />
              Weekly Recurring Schedule
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Define the day type and required officers for each day of the week.
              This schedule repeats every week starting from the effective date.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={resetToBuiltinDefaults} className="btn-secondary text-xs px-3 py-1.5">
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
            <button onClick={saveWeeklySchedule} disabled={savingWeekly} className="btn-primary">
              {savingWeekly ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
              Save Schedule
            </button>
          </div>
        </div>

        {/* Effective from date */}
        <div className="flex items-center gap-4 p-4 bg-amber-500/5 border border-amber-500/15 rounded-xl">
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-300">Effective From</p>
            <p className="text-xs text-slate-500 mt-0.5">
              The recurring schedule only applies to dates on or after this date.
              Past attendance records are never retroactively changed.
            </p>
          </div>
          <input
            id="schedule-effective-from"
            type="date"
            className="input w-44 flex-shrink-0 border-amber-500/20 focus:ring-amber-500/30"
            value={effectiveFrom}
            onChange={e => setEffectiveFrom(e.target.value)}
          />
        </div>

        {/* Day rows */}
        <div className="space-y-2">
          {DAYS_OF_WEEK.map(({ idx, full }) => (
            <DayOfficerPicker
              key={idx}
              dayIdx={idx}
              schedule={schedule}
              setSchedule={setSchedule}
              officers={officers}
            />
          ))}
        </div>

        {officers.length === 0 && (
          <div className="flex items-center gap-2 text-slate-500 text-sm pt-2">
            <Info className="w-4 h-4 flex-shrink-0" />
            Enrol officers on the Officer Roster page first, then come back to assign them per day.
          </div>
        )}
      </div>

      {/* ── Section B: Specific Date Overrides ────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-white">Specific Date Overrides</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Override a specific date regardless of the weekly schedule.
              Highest priority — always takes effect over the recurring schedule.
            </p>
          </div>
          <button id="add-override-btn" onClick={() => setModal('add')} className="btn-primary">
            <Plus className="w-4 h-4" /> Add Override
          </button>
        </div>

        {overrides.length === 0 ? (
          <p className="text-sm text-slate-600 py-4 text-center">
            No date overrides yet. Click "Add Override" to configure a specific date (e.g. a special holiday).
          </p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Day</th>
                  <th>Type</th>
                  <th>Note</th>
                  <th>Required Officers</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {overrides.map(ov => {
                  const dt  = DAY_TYPES.find(d => d.value === ov.type)
                  const dow = DAYS_OF_WEEK[parseISO(ov.date).getDay()]?.short ?? '—'
                  return (
                    <tr key={ov.date}>
                      <td className="font-mono text-sm">{format(parseISO(ov.date), 'MMM d, yyyy')}</td>
                      <td className="text-slate-500 text-xs">{dow}</td>
                      <td><span className="text-sm">{dt?.label ?? ov.type}</span></td>
                      <td className="text-slate-400 text-sm">{ov.note || '—'}</td>
                      <td className="text-slate-400 text-xs">
                        {ov.required_uids ? `${ov.required_uids.length} custom` : 'Weekly default'}
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setModal(ov)}
                            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-slate-200">
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => deleteOverride(ov.date)}
                            className="p-1.5 hover:bg-red-500/15 rounded-lg transition-colors text-slate-400 hover:text-red-400">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <DayOverrideModal
          existing={modal === 'add' ? null : modal}
          allOfficers={officers}
          weeklySchedule={schedule}
          onClose={() => setModal(null)}
          onSave={async () => { setModal(null); await refreshOverrides() }}
        />
      )}
    </div>
  )
}
