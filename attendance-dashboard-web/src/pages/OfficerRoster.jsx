// pages/OfficerRoster.jsx
// -----------------------
// CRUD interface for officers in the Firestore `officers` collection.
// Each officer document uses their NFC card UID as the document ID.

import { useState, useEffect, useRef } from 'react'
import {
  collection, doc, getDocs, setDoc, deleteDoc, onSnapshot,
} from 'firebase/firestore'
import { db } from '../firebase'
import toast from 'react-hot-toast'
import { Users, Plus, Pencil, Trash2, X, Save, UserCircle } from 'lucide-react'

const POSITIONS = [
  'President', 'Vice President', 'Secretary', 'Treasurer',
  'Auditor', 'PRO', 'Senator', 'Representative', 'Other',
]

const EMPTY_FORM = {
  card_uid: '', first_name: '', last_name: '', position: 'President',
  status: 'OFF_DUTY', photo_url: '',
}

function OfficerModal({ officer, onClose, onSave }) {
  const [form, setForm]             = useState(officer ?? EMPTY_FORM)
  const [saving, setSaving]         = useState(false)
  const [lastAutoTap, setLastAutoTap] = useState(null)
  const isEdit = Boolean(officer)
  const openedTimeRef = useRef(Date.now())

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // ── Auto-listen for NFC taps from reader while modal is open ────────────
  useEffect(() => {
    if (isEdit) return // don't overwrite UID when editing existing officer

    const unsub = onSnapshot(doc(db, 'system_settings', 'live_scanner'), (snap) => {
      if (!snap.exists()) return
      const data = snap.data()
      if (!data?.latest_uid) return

      // Auto-populate the card UID
      const uid = data.latest_uid.toUpperCase().trim()
      setForm(f => ({ ...f, card_uid: uid }))
      setLastAutoTap(uid)
      toast.success(`⚡ Card detected: ${uid}`, { id: 'live-tap-toast' })
    })

    return () => unsub()
  }, [isEdit])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.card_uid.trim()) return toast.error('Card UID is required.')
    if (!form.first_name.trim() || !form.last_name.trim()) return toast.error('Name is required.')

    setSaving(true)
    try {
      const uid = form.card_uid.toUpperCase().trim()
      await setDoc(doc(db, 'officers', uid), {
        first_name: form.first_name.trim(),
        last_name:  form.last_name.trim(),
        position:   form.position,
        status:     form.status,
        photo_url:  form.photo_url.trim(),
      }, { merge: true })
      toast.success(isEdit ? 'Officer updated.' : 'Officer enrolled.')
      onSave()
    } catch (err) {
      toast.error(`Error: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="card w-full max-w-lg p-6 space-y-5 animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-white text-lg">
            {isEdit ? 'Edit Officer' : 'Enrol New Officer'}
          </h2>
          <button id="close-modal-btn" onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Card UID */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="label mb-0">NFC Card UID</label>
              {!isEdit && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Tap card on reader to scan
                </span>
              )}
            </div>
            <input
              id="officer-card-uid"
              className={`input font-mono transition-all duration-300 ${
                lastAutoTap ? 'border-emerald-500 ring-2 ring-emerald-500/30' : ''
              }`}
              placeholder="e.g. A1B2C3D4 (or tap on reader)"
              value={form.card_uid}
              onChange={e => {
                set('card_uid', e.target.value)
                setLastAutoTap(null)
              }}
              disabled={isEdit}
              required
            />
            {!isEdit && (
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                {lastAutoTap ? (
                  <span className="text-emerald-400 font-medium">
                    ✓ Auto-detected from NFC Reader ({lastAutoTap})
                  </span>
                ) : (
                  <span>
                    💡 Ready: Tap your NFC card on the ACR122U and the UID will fill automatically.
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">First Name</label>
              <input id="officer-first-name" className="input" placeholder="Juan" value={form.first_name}
                onChange={e => set('first_name', e.target.value)} required />
            </div>
            <div>
              <label className="label">Last Name</label>
              <input id="officer-last-name" className="input" placeholder="dela Cruz" value={form.last_name}
                onChange={e => set('last_name', e.target.value)} required />
            </div>
          </div>

          {/* Position */}
          <div>
            <label className="label">Position</label>
            <select id="officer-position" className="input" value={form.position}
              onChange={e => set('position', e.target.value)}>
              {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* Photo URL (optional) */}
          <div>
            <label className="label">Photo URL <span className="normal-case text-slate-600">(optional)</span></label>
            <input id="officer-photo-url" className="input" placeholder="https://…" value={form.photo_url}
              onChange={e => set('photo_url', e.target.value)} />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" id="cancel-officer-btn" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" id="save-officer-btn" disabled={saving} className="btn-primary">
              {saving
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</>
                : <><Save className="w-4 h-4" />{isEdit ? 'Save Changes' : 'Enrol Officer'}</>
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function OfficerCard({ officer, onEdit, onDelete }) {
  const { card_uid, first_name, last_name, position, status, photo_url } = officer
  const initials = `${first_name?.[0] ?? ''}${last_name?.[0] ?? ''}`.toUpperCase()

  return (
    <div className="card-hover p-5 space-y-4 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        {/* Avatar + name */}
        <div className="flex items-center gap-3">
          {photo_url ? (
            <img src={photo_url} alt={first_name} className="w-11 h-11 rounded-full object-cover border border-white/15" />
          ) : (
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-brand-500/40 to-violet-500/40 border border-brand-500/30 flex items-center justify-center text-sm font-bold text-brand-200">
              {initials || <UserCircle className="w-5 h-5" />}
            </div>
          )}
          <div>
            <p className="font-semibold text-white">{first_name} {last_name}</p>
            <p className="text-xs text-slate-400">{position}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button id={`edit-${card_uid}`} onClick={() => onEdit(officer)}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-slate-200">
            <Pencil className="w-4 h-4" />
          </button>
          <button id={`delete-${card_uid}`} onClick={() => onDelete(officer)}
            className="p-2 hover:bg-red-500/15 rounded-lg transition-colors text-slate-400 hover:text-red-400">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Status + UID */}
      <div className="flex items-center justify-between">
        <span className={status === 'ON_DUTY' ? 'badge-on-duty' : 'badge-off-duty'}>
          <span className={`w-1.5 h-1.5 rounded-full ${status === 'ON_DUTY' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
          {status === 'ON_DUTY' ? 'On Duty' : 'Off Duty'}
        </span>
        <span className="text-xs font-mono text-slate-600">{card_uid}</span>
      </div>
    </div>
  )
}

export default function OfficerRoster() {
  const [officers, setOfficers]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [modal, setModal]         = useState(null)  // null | 'add' | officer object
  const [search, setSearch]       = useState('')

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'officers'), (snap) => {
      setOfficers(snap.docs.map(d => ({ card_uid: d.id, ...d.data() })))
      setLoading(false)
    }, err => {
      toast.error('Could not load officers: ' + err.message)
      setLoading(false)
    })
    return () => unsub()
  }, [])

  const handleDelete = async (officer) => {
    if (!window.confirm(`Delete ${officer.first_name} ${officer.last_name}? This cannot be undone.`)) return
    try {
      await deleteDoc(doc(db, 'officers', officer.card_uid))
      toast.success('Officer deleted.')
    } catch (err) {
      toast.error('Delete failed: ' + err.message)
    }
  }

  const filtered = officers.filter(o => {
    const q = search.toLowerCase()
    return !q
      || o.first_name?.toLowerCase().includes(q)
      || o.last_name?.toLowerCase().includes(q)
      || o.position?.toLowerCase().includes(q)
      || o.card_uid?.toLowerCase().includes(q)
  })

  const onDuty   = officers.filter(o => o.status === 'ON_DUTY').length
  const offDuty  = officers.length - onDuty

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Users className="w-6 h-6 text-brand-400" />
            Officer Roster
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            {officers.length} officer{officers.length !== 1 ? 's' : ''} enrolled
            &nbsp;·&nbsp;
            <span className="text-emerald-400">{onDuty} on duty</span>
            &nbsp;·&nbsp;
            <span className="text-slate-500">{offDuty} off duty</span>
          </p>
        </div>
        <button id="add-officer-btn" onClick={() => setModal('add')} className="btn-primary">
          <Plus className="w-4 h-4" />
          Enrol Officer
        </button>
      </div>

      {/* Search */}
      <input
        id="officer-search"
        className="input max-w-sm"
        placeholder="Search by name, position, or UID…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mr-3" />
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
          <Users className="w-12 h-12 opacity-20" />
          <p className="text-sm">{search ? 'No officers match your search.' : 'No officers enrolled yet.'}</p>
          {!search && (
            <button onClick={() => setModal('add')} className="btn-primary mt-2">
              <Plus className="w-4 h-4" /> Enrol First Officer
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(o => (
            <OfficerCard
              key={o.card_uid}
              officer={o}
              onEdit={setModal}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <OfficerModal
          officer={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSave={() => setModal(null)}
        />
      )}
    </div>
  )
}
