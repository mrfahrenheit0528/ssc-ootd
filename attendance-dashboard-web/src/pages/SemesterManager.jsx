// pages/SemesterManager.jsx
// -------------------------
// Admin-only page to start, end, reactivate (unarchive), edit, and manage semesters.
//
// Firestore: semesters/{id}
//   id:               'sem_...' (auto-generated)
//   name:             '1st Semester AY 2026-2027'
//   start_date:       'YYYY-MM-DD'
//   end_date:         'YYYY-MM-DD' or null (null = active)
//   status:           'active' | 'ended'
//   officer_snapshot: [{ card_uid, first_name, last_name, position, photo_url }]
//
// Only one semester can be 'active' at a time.
// Admins can unarchive any past semester at any time.

import { useState } from 'react'
import {
  collection, doc, getDocs, setDoc, updateDoc, deleteDoc, Timestamp,
} from 'firebase/firestore'
import { format, parseISO } from 'date-fns'
import { db } from '../firebase'
import { useSemester } from '../contexts/SemesterContext'
import toast from 'react-hot-toast'
import {
  GraduationCap, Plus, StopCircle, Users, CalendarRange,
  ChevronRight, Archive, Clock, RotateCcw, Pencil, Trash2, X, Save,
} from 'lucide-react'

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeSemesterId() {
  return `sem_${Date.now()}`
}

function fmtDate(d) {
  if (!d) return '—'
  try { return format(parseISO(d), 'MMMM d, yyyy') } catch { return d }
}

// ── Edit Semester Modal ───────────────────────────────────────────────────────
function EditSemesterModal({ semester, onClose, onSave }) {
  const [name,      setName]      = useState(semester.name || '')
  const [startDate, setStartDate] = useState(semester.start_date || '')
  const [endDate,   setEndDate]   = useState(semester.end_date || '')
  const [saving,    setSaving]    = useState(false)

  const handleSave = async (e) => {
    e.preventDefault()
    if (!name.trim()) return toast.error('Semester name is required.')
    if (!startDate)   return toast.error('Start date is required.')

    setSaving(true)
    try {
      await updateDoc(doc(db, 'semesters', semester.id), {
        name:       name.trim(),
        start_date: startDate,
        end_date:   semester.status === 'ended' ? (endDate || null) : null,
      })
      toast.success('Semester updated.')
      onSave()
    } catch (err) {
      toast.error('Failed to update semester: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="card w-full max-w-md p-6 space-y-5 animate-slide-up">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-white text-lg">Edit Semester</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="label">Semester Name</label>
            <input
              className="input"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Start Date</label>
              <input
                type="date"
                className="input"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                required
              />
            </div>
            {semester.status === 'ended' && (
              <div>
                <label className="label">End Date</label>
                <input
                  type="date"
                  className="input"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Save className="w-4 h-4" />
              }
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Start New Semester Form ───────────────────────────────────────────────────
function StartSemesterForm({ onStarted }) {
  const [name,      setName]      = useState('')
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [saving,    setSaving]    = useState(false)

  const handleStart = async () => {
    if (!name.trim()) return toast.error('Semester name is required.')
    if (!startDate)   return toast.error('Start date is required.')
    setSaving(true)
    try {
      const id = makeSemesterId()
      await setDoc(doc(db, 'semesters', id), {
        name:             name.trim(),
        start_date:       startDate,
        end_date:         null,
        status:           'active',
        officer_snapshot: [],
        created_at:       Timestamp.now(),
      })
      toast.success(`Semester "${name.trim()}" started!`)
      setName('')
      onStarted?.()
    } catch (err) {
      toast.error('Failed to start semester: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-6 space-y-5 border-brand-500/20 bg-brand-500/5">
      <div>
        <h2 className="font-semibold text-white flex items-center gap-2">
          <Plus className="w-4 h-4 text-brand-400" />
          Start a New Semester
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Start a new academic term to begin tracking attendance records.
        </p>
      </div>
      <div className="space-y-4">
        <div>
          <label className="label">Semester Name</label>
          <input
            id="semester-name"
            className="input"
            placeholder="e.g. 1st Semester AY 2026-2027"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Start Date</label>
          <input
            id="semester-start-date"
            type="date"
            className="input w-48"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
        </div>
      </div>
      <button
        id="start-semester-btn"
        onClick={handleStart}
        disabled={saving}
        className="btn-primary"
      >
        {saving
          ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          : <GraduationCap className="w-4 h-4" />
        }
        {saving ? 'Starting…' : 'Start Semester'}
      </button>
    </div>
  )
}

// ── Active Semester Card ──────────────────────────────────────────────────────
function ActiveSemesterCard({ semester, onEdit }) {
  const [ending,  setEnding]  = useState(false)
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [confirm, setConfirm] = useState(false)

  const handleEndSemester = async () => {
    setEnding(true)
    try {
      // Take a snapshot of current officers with safe fallbacks
      const officersSnap = await getDocs(collection(db, 'officers'))
      const snapshot = officersSnap.docs.map(d => {
        const data = d.data() || {}
        return {
          card_uid:   d.id || '',
          first_name: data.first_name || '',
          last_name:  data.last_name || '',
          position:   data.position || 'Officer',
          photo_url:  data.photo_url || '',
        }
      })

      const safeEndDate = endDate || format(new Date(), 'yyyy-MM-dd')

      await updateDoc(doc(db, 'semesters', semester.id), {
        status:           'ended',
        end_date:         safeEndDate,
        officer_snapshot: snapshot,
        ended_at:         Timestamp.now(),
      })
      toast.success(`Semester "${semester.name}" has been ended and archived.`)
      setConfirm(false)
    } catch (err) {
      console.error('End semester error:', err)
      toast.error('Failed to end semester: ' + err.message)
    } finally {
      setEnding(false)
    }
  }

  return (
    <div className="card p-6 space-y-5 border-emerald-500/20 bg-emerald-500/5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Active Term
            </span>
          </div>
          <h2 className="text-xl font-bold text-white">{semester.name}</h2>
          <p className="text-slate-400 text-sm mt-1 flex items-center gap-2">
            <CalendarRange className="w-3.5 h-3.5" />
            Started {fmtDate(semester.start_date)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(semester)}
            className="btn-secondary"
          >
            <Pencil className="w-4 h-4" /> Edit
          </button>
          <button
            id="end-semester-btn"
            onClick={() => setConfirm(true)}
            className="btn-danger"
          >
            <StopCircle className="w-4 h-4" />
            End Semester
          </button>
        </div>
      </div>

      {/* Confirm End dialog */}
      {confirm && (
        <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-5 space-y-4">
          <p className="text-red-300 font-semibold text-sm">
            ⚠️ End "{semester.name}"?
          </p>
          <p className="text-xs text-slate-400">
            This will archive the semester and snapshot all currently enrolled officers.
            You can still view all past records or unarchive this semester at any time.
          </p>
          <div>
            <label className="label">End Date</label>
            <input type="date" className="input w-48"
              value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setConfirm(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleEndSemester} disabled={ending} className="btn-danger">
              {ending
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Archive className="w-4 h-4" />
              }
              {ending ? 'Archiving…' : 'Yes, End Semester'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Past Semesters List ───────────────────────────────────────────────────────
function PastSemestersList({ semesters, activeSemester, onEdit }) {
  const past = semesters.filter(s => s.status === 'ended')
  const [reactivating, setReactivating] = useState(null)

  const handleUnarchive = async (targetSem) => {
    if (activeSemester) {
      const confirmSwap = window.confirm(
        `Reactivate "${targetSem.name}"?\n\nThis will archive the currently active semester ("${activeSemester.name}") first.`
      )
      if (!confirmSwap) return
    } else {
      const confirmSimple = window.confirm(`Reactivate "${targetSem.name}" as the active semester?`)
      if (!confirmSimple) return
    }

    setReactivating(targetSem.id)
    try {
      // 1. If there's an active semester, snapshot and archive it
      if (activeSemester) {
        const officersSnap = await getDocs(collection(db, 'officers'))
        const snapshot = officersSnap.docs.map(d => {
          const data = d.data() || {}
          return {
            card_uid:   d.id || '',
            first_name: data.first_name || '',
            last_name:  data.last_name || '',
            position:   data.position || 'Officer',
            photo_url:  data.photo_url || '',
          }
        })
        await updateDoc(doc(db, 'semesters', activeSemester.id), {
          status:           'ended',
          end_date:         format(new Date(), 'yyyy-MM-dd'),
          officer_snapshot: snapshot,
          ended_at:         Timestamp.now(),
        })
      }

      // 2. Reactivate the target semester
      await updateDoc(doc(db, 'semesters', targetSem.id), {
        status:   'active',
        end_date: null,
      })

      toast.success(`"${targetSem.name}" is now the active semester!`)
    } catch (err) {
      toast.error('Failed to reactivate semester: ' + err.message)
    } finally {
      setReactivating(null)
    }
  }

  const handleDelete = async (sem) => {
    if (!window.confirm(`Permanently delete semester record "${sem.name}"? This cannot be undone.`)) return
    try {
      await deleteDoc(doc(db, 'semesters', sem.id))
      toast.success('Semester record deleted.')
    } catch (err) {
      toast.error('Delete failed: ' + err.message)
    }
  }

  if (past.length === 0) return null

  return (
    <div className="card p-6 space-y-4">
      <div>
        <h2 className="font-semibold text-white flex items-center gap-2">
          <Archive className="w-4 h-4 text-slate-400" />
          Past Semesters ({past.length})
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Historical records are preserved. You can view, edit, or unarchive any semester below.
        </p>
      </div>

      <div className="space-y-2">
        {past.map(s => (
          <div key={s.id} className="flex items-center justify-between gap-4 p-4 rounded-xl border border-white/8 bg-white/2 hover:bg-white/4 transition-colors flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-slate-100 truncate">{s.name}</p>
                <span className="px-2 py-0.5 rounded-md text-2xs uppercase tracking-wider font-semibold bg-white/10 text-slate-400">
                  Archived
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1">
                  <CalendarRange className="w-3 h-3" />
                  {fmtDate(s.start_date)} — {fmtDate(s.end_date)}
                </span>
                {s.officer_snapshot?.length > 0 && (
                  <span className="flex items-center gap-1 text-slate-400">
                    · <Users className="w-3 h-3" />
                    {s.officer_snapshot.length} officers
                  </span>
                )}
              </p>
            </div>

            {/* Actions: Unarchive, Edit, Delete */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => handleUnarchive(s)}
                disabled={reactivating === s.id}
                className="btn-secondary text-xs px-3 py-1.5 hover:border-brand-500/40 hover:text-brand-300"
                title="Unarchive / Reactivate as active semester"
              >
                {reactivating === s.id
                  ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <RotateCcw className="w-3.5 h-3.5" />
                }
                Unarchive
              </button>
              <button
                onClick={() => onEdit(s)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-slate-200"
                title="Edit name and dates"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleDelete(s)}
                className="p-2 hover:bg-red-500/15 rounded-lg transition-colors text-slate-400 hover:text-red-400"
                title="Delete semester"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SemesterManager() {
  const { semesters, activeSemester, loading } = useSemester()
  const [editModal, setEditModal]               = useState(null)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mr-3" />
        Loading…
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-slide-up max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <GraduationCap className="w-6 h-6 text-brand-400" />
          Semester Management
        </h1>
        <p className="text-slate-400 mt-1 text-sm">
          Start terms, archive completed semesters with officer snapshots, or unarchive past terms.
        </p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 bg-blue-500/5 border border-blue-500/15 rounded-xl text-xs text-slate-400">
        <Clock className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <p>
          When you <strong className="text-slate-300">end a semester</strong>, all enrolled officers are snapshotted so historical records remain accurate. You can always <strong className="text-slate-300">unarchive</strong> a semester later if it was closed prematurely.
        </p>
      </div>

      {/* Active semester or start new */}
      {activeSemester ? (
        <ActiveSemesterCard semester={activeSemester} onEdit={setEditModal} />
      ) : (
        <StartSemesterForm />
      )}

      {/* Past semesters */}
      <PastSemestersList
        semesters={semesters}
        activeSemester={activeSemester}
        onEdit={setEditModal}
      />

      {/* Start another semester even if there are past ones */}
      {activeSemester && (
        <div className="pt-2">
          <details className="card p-5 cursor-pointer group">
            <summary className="text-sm font-medium text-slate-400 group-open:text-white flex items-center justify-between">
              <span>Looking to start a different term?</span>
              <ChevronRight className="w-4 h-4 transform group-open:rotate-90 transition-transform" />
            </summary>
            <div className="pt-4 border-t border-white/8 mt-3">
              <p className="text-xs text-slate-500 mb-4">
                Ending the current active semester above will prompt you to start the next one.
              </p>
            </div>
          </details>
        </div>
      )}

      {/* Edit modal */}
      {editModal && (
        <EditSemesterModal
          semester={editModal}
          onClose={() => setEditModal(null)}
          onSave={() => setEditModal(null)}
        />
      )}
    </div>
  )
}
