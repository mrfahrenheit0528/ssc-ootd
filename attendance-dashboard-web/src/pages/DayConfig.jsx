// pages/DayConfig.jsx
// -------------------
// Admin-only page for configuring day types and required officers.
// Firestore schema:
//   day_config/defaults         → { required_uids: [...], updated_at }
//   day_config/{YYYY-MM-DD}     → { type, note, required_uids }

import { useState, useEffect } from 'react'
import { collection, doc, getDoc, setDoc, getDocs, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { Settings, Save, Plus, Trash2, X, Info } from 'lucide-react'

const DAY_TYPES = [
  { value: 'regular',    label: '📅 Regular',     desc: 'Normal school day, attendance required' },
  { value: 'holiday',    label: '🎉 Holiday',     desc: 'No classes, no attendance required' },
  { value: 'no_classes', label: '📚 No Classes',  desc: 'School is open but no classes (e.g. faculty seminar)' },
  { value: 'optional',   label: '🔵 Optional',    desc: 'Attendance is encouraged but not mandatory' },
]

// ── Day Override Modal ────────────────────────────────────────────────────────
function DayOverrideModal({ existing, allOfficers, defaultRequired, onClose, onSave }) {
  const [date,         setDate]         = useState(existing?.date ?? format(new Date(), 'yyyy-MM-dd'))
  const [type,         setType]         = useState(existing?.type ?? 'regular')
  const [note,         setNote]         = useState(existing?.note ?? '')
  const [useCustomReq, setUseCustomReq] = useState(Boolean(existing?.required_uids))
  const [customReq,    setCustomReq]    = useState(existing?.required_uids ?? defaultRequired)
  const [saving,       setSaving]       = useState(false)

  const toggleOfficer = (uid) => {
    setCustomReq(prev =>
      prev.includes(uid) ? prev.filter(u => u !== uid) : [...prev, uid]
    )
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
      toast.success(`Day config saved for ${format(parseISO(date), 'MMM d, yyyy')}.`)
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
          <h2 className="font-bold text-white text-lg">{existing ? 'Edit Day Override' : 'Add Day Override'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Date */}
        <div>
          <label className="label">Date</label>
          <input id="day-override-date" type="date" className="input"
            value={date} onChange={e => setDate(e.target.value)} disabled={Boolean(existing)} />
        </div>

        {/* Day type */}
        <div>
          <label className="label">Day Type</label>
          <div className="space-y-2">
            {DAY_TYPES.map(dt => (
              <label key={dt.value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors
                ${type === dt.value ? 'bg-brand-500/10 border-brand-500/40' : 'bg-white/3 border-white/10 hover:bg-white/5'}`}>
                <input type="radio" name="day-type" value={dt.value}
                  checked={type === dt.value} onChange={() => setType(dt.value)}
                  className="mt-0.5 accent-indigo-500" />
                <div>
                  <p className="text-sm font-medium text-slate-100">{dt.label}</p>
                  <p className="text-xs text-slate-500">{dt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Note */}
        <div>
          <label className="label">Note <span className="normal-case text-slate-600">(optional)</span></label>
          <input id="day-override-note" className="input" placeholder="e.g. Intramurals, Faculty seminar…"
            value={note} onChange={e => setNote(e.target.value)} />
        </div>

        {/* Custom required officers */}
        <div>
          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <input type="checkbox" checked={useCustomReq} onChange={e => setUseCustomReq(e.target.checked)}
              className="accent-indigo-500" />
            <span className="text-sm text-slate-300">Override required officers for this day</span>
          </label>
          {useCustomReq && (
            <div className="space-y-2 max-h-48 overflow-y-auto p-1">
              {allOfficers.length === 0 ? (
                <p className="text-xs text-slate-500">No officers enrolled yet.</p>
              ) : allOfficers.map(o => (
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
  const [officers,        setOfficers]        = useState([])
  const [defaultRequired, setDefaultRequired] = useState([])
  const [overrides,       setOverrides]       = useState([])
  const [loading,         setLoading]         = useState(true)
  const [savingDefault,   setSavingDefault]   = useState(false)
  const [modal,           setModal]           = useState(null) // null | 'add' | override obj
  const [selectedDefault, setSelectedDefault] = useState([])

  useEffect(() => {
    const fetchAll = async () => {
      const [officersSnap, defaultsSnap, configSnap] = await Promise.all([
        getDocs(collection(db, 'officers')),
        getDoc(doc(db, 'day_config', 'defaults')),
        getDocs(collection(db, 'day_config')),
      ])
      const ofs = officersSnap.docs.map(d => ({ card_uid: d.id, ...d.data() }))
      setOfficers(ofs)

      const def = defaultsSnap.exists() ? (defaultsSnap.data().required_uids ?? []) : []
      setDefaultRequired(def)
      setSelectedDefault(def)

      const ovrs = configSnap.docs
        .filter(d => d.id !== 'defaults')
        .map(d => ({ date: d.id, ...d.data() }))
        .sort((a, b) => a.date.localeCompare(b.date))
      setOverrides(ovrs)
      setLoading(false)
    }
    fetchAll().catch(() => setLoading(false))
  }, [])

  const toggleDefault = (uid) => {
    setSelectedDefault(prev =>
      prev.includes(uid) ? prev.filter(u => u !== uid) : [...prev, uid]
    )
  }

  const saveDefaults = async () => {
    setSavingDefault(true)
    try {
      await setDoc(doc(db, 'day_config', 'defaults'), {
        required_uids: selectedDefault,
        updated_at: new Date(),
      }, { merge: true })
      setDefaultRequired(selectedDefault)
      toast.success('Default required officers saved.')
    } catch (err) {
      toast.error('Save failed: ' + err.message)
    } finally {
      setSavingDefault(false)
    }
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
      .filter(d => d.id !== 'defaults')
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
          Define required officers and set special day types for the attendance calendar.
        </p>
      </div>

      {/* Section A: Default required officers */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-white">Default Required Officers</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Officers required to attend every regular school day unless overridden.
            </p>
          </div>
          <button onClick={saveDefaults} disabled={savingDefault} className="btn-primary">
            {savingDefault ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>

        {officers.length === 0 ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
            <Info className="w-4 h-4" />
            No officers enrolled yet. Go to Officer Roster first.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {officers.map(o => (
              <label key={o.card_uid} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-colors
                ${selectedDefault.includes(o.card_uid) ? 'bg-brand-500/10 border-brand-500/30' : 'border-white/8 hover:bg-white/5'}`}>
                <input type="checkbox" checked={selectedDefault.includes(o.card_uid)}
                  onChange={() => toggleDefault(o.card_uid)} className="accent-indigo-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-100 truncate">{o.first_name} {o.last_name}</p>
                  <p className="text-xs text-slate-500">{o.position}</p>
                </div>
              </label>
            ))}
          </div>
        )}
        <p className="text-xs text-slate-600">
          {selectedDefault.length} of {officers.length} officers selected as required.
        </p>
      </div>

      {/* Section B: Day overrides */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-white">Day Overrides</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Mark specific dates as holidays, no-class days, or change the required officers.
            </p>
          </div>
          <button id="add-override-btn" onClick={() => setModal('add')} className="btn-primary">
            <Plus className="w-4 h-4" /> Add Override
          </button>
        </div>

        {overrides.length === 0 ? (
          <p className="text-sm text-slate-600 py-4 text-center">
            No overrides yet. Click "Add Override" to configure a specific date.
          </p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Note</th>
                  <th>Required Officers</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {overrides.map(ov => {
                  const dt = DAY_TYPES.find(d => d.value === ov.type)
                  return (
                    <tr key={ov.date}>
                      <td className="font-mono text-sm">{format(parseISO(ov.date), 'MMM d, yyyy')}</td>
                      <td><span className="text-sm">{dt?.label ?? ov.type}</span></td>
                      <td className="text-slate-400 text-sm">{ov.note || '—'}</td>
                      <td className="text-slate-400 text-xs">
                        {ov.required_uids
                          ? `${ov.required_uids.length} custom`
                          : 'Default'}
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
          defaultRequired={defaultRequired}
          onClose={() => setModal(null)}
          onSave={async () => { setModal(null); await refreshOverrides() }}
        />
      )}
    </div>
  )
}
