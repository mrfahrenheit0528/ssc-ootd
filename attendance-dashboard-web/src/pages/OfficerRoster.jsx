// pages/OfficerRoster.jsx
// -----------------------
// CRUD interface for officers. Supports:
//  - Admin: add/edit/delete officers, upload photo with canvas compression & PostgreSQL binary storage
//  - Approved members: view officer cards with photo & status
//  - Admin enrol modal: NFC card auto-fills UID (timestamp-gated)
//  - Structured council positions: Executive (1 each), College Reps (2 each), Assistant Officers (multiple)
//  - Historical roster: view archived officer snapshot from any past semester

import Select from '../components/Select'
import OfficerNameCombobox from '../components/OfficerNameCombobox'
import PendingCards from '../components/PendingCards'
import { nfcUid } from '../utils/officerIdentity'
import { useState, useEffect, useRef } from 'react'
import { saveOfficerProfile, setEnrollment, recoverAttendance, deleteRecord, watchRecords, watchRecord, uploadPhoto } from '../data'
import { dateKey, isDayClosed } from '../utils/attendanceTime'
import { useAuth } from '../contexts/AuthContext'
import { useSemester } from '../contexts/SemesterContext'
import toast from 'react-hot-toast'
import {
  Users, Plus, Pencil, Trash2, X, Save, UserCircle,
  Camera, GraduationCap, Archive, AlertCircle, Image as ImageIcon,
} from 'lucide-react'

// ── Council Positions Structure ───────────────────────────────────────────────
export const POSITION_GROUPS = [
  {
    group: 'Executive Board & Directors (1 each)',
    limit: 1,
    positions: [
      'President and Student Trustee',
      'VPEA',
      'VPIA',
      'Secretary',
      'Treasurer',
      'Auditor',
      'Property Custodian',
      'Public Relations Officer',
      'VSPST',
      'SPST',
      'Student Rights and Welfare Director',
      'Gender and Development Director',
      'Sports and Cultural Director',
      'Environmental Concerns Director',
    ],
  },
  {
    group: 'College & Campus Representatives (2 each)',
    limit: 2,
    positions: [
      'BUHI Representative',
      'CAS Representative',
      'CCS Representative',
      'CEA Representative',
      'CHS Representative',
      'CTDE Representative',
      'CTHBM Representative',
    ],
  },
  {
    group: 'Assistant Officers (Multiple)',
    limit: null, // unlimited
    positions: [
      'Asst. Secretary',
      'Asst. Treasurer',
      'Asst. Auditor',
      'Asst. Property Custodian',
      'Asst. Public Relations Officer',
    ],
  },
]

export const ALL_POSITIONS = POSITION_GROUPS.flatMap(g => g.positions)

const EMPTY_FORM = {
  card_uid: '', first_name: '', last_name: '',
  position: 'Officer',
  status: 'OFF_DUTY', photo_url: '',
}

// ── Image Compressor Helper (Canvas to 400x400 max, JPEG 0.85) ────────────────
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const MAX_SIZE = 400
        let width = img.width
        let height = img.height

        if (width > height) {
          if (width > MAX_SIZE) {
            height = Math.round((height * MAX_SIZE) / width)
            width = MAX_SIZE
          }
        } else {
          if (height > MAX_SIZE) {
            width = Math.round((width * MAX_SIZE) / height)
            height = MAX_SIZE
          }
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)

        const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        canvas.toBlob((blob) => {
          resolve({ blob: blob || file, dataUrl })
        }, 'image/jpeg', 0.85)
      }
      img.onerror = reject
      img.src = e.target.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Officer Enrol / Edit Modal ────────────────────────────────────────────────
function OfficerModal({ officer, existingOfficers = [], onClose, onSave }) {
  const initialForm = {
    card_uid:   nfcUid(officer) || officer?.pending_card_uid || '',
    first_name: officer?.first_name || '',
    last_name:  officer?.last_name || '',
    position:   officer?.position || 'Officer',
    status:     officer?.status || 'OFF_DUTY',
    photo_url:  officer?.photo_url || '',
    photo_id: officer?.photo_id || null,
  }

  const [form,         setForm]         = useState(initialForm)
  const [saving,       setSaving]       = useState(false)
  const [photoFile,    setPhotoFile]    = useState(null)
  const [photoPreview, setPhotoPreview] = useState(officer?.photo_url || null)
  const [lastAutoTap,  setLastAutoTap]  = useState(null)
  const [selectedKey,setSelectedKey] = useState(null)
  const [identityQuery,setIdentityQuery] = useState(`${initialForm.first_name} ${initialForm.last_name}`.trim())
  const targetKey = officer?.card_uid || selectedKey
  const isEdit = Boolean(targetKey)
  const linkedCard = nfcUid(officer)
  const fileInputRef = useRef(null)
  const enrollmentOwner = useRef(crypto.randomUUID())
  const [enrolling,setEnrolling] = useState(false)
  const [leaseError,setLeaseError] = useState('')
  const [leaseRetry,setLeaseRetry] = useState(0)

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    if (k === 'first_name') setIdentityQuery(`${v} ${form.last_name}`.trim())
    if (k === 'last_name') setIdentityQuery(`${form.first_name} ${v}`.trim())
  }

  useEffect(() => {
    if(linkedCard) return
    let stopped = false
    const owner = crypto.randomUUID()
    enrollmentOwner.current = owner
    setEnrolling(false)
    const renew = async () => {
      try {
        const acquired = await setEnrollment(owner,true)
        if(stopped && acquired) await setEnrollment(owner,false)
        if(!stopped) {setEnrolling(acquired);setLeaseError(acquired ? '' : 'Another admin is enrolling a card. Close their enrollment window, or wait for its lease to expire, then retry.')}
      } catch(e) {if(!stopped){setEnrolling(false);setLeaseError('Card enrollment unavailable: '+e.message)}}
    }
    renew()
    const timer = setInterval(renew,20000)
    return () => {stopped=true;clearInterval(timer);setEnrollment(owner,false).catch(()=>{})}
  },[linkedCard,leaseRetry])
  useEffect(() => {
    if(linkedCard || !enrolling) return
    return watchRecord('system_settings','live_scanner',data => {
      if(!data?.latest_uid || data.owner !== enrollmentOwner.current) return
      const uid=data.latest_uid.toUpperCase().trim()
      setForm(f=>({...f,card_uid:uid}));setLastAutoTap(uid)
    },e=>setLeaseError('Scanner connection interrupted: '+e.message))
  },[linkedCard,enrolling])

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Please choose a photo under 8 MB.')
      return
    }
    try {
      const { blob, dataUrl } = await compressImage(file)
      setPhotoFile(blob)
      setPhotoPreview(dataUrl)
      toast.success('Photo selected & optimized!')
    } catch (err) {
      console.error('Image compression failed:', err)
      toast.error('Please choose a valid JPEG or PNG image.')
    }
  }

  const handleRemovePhoto = () => {
    setPhotoFile(null)
    setPhotoPreview(null)
    setForm(f => ({ ...f, photo_url: '' }))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Check position occupancy ──────────────────────────────────────────────
  const selectedPos = form.position || ALL_POSITIONS[0]
  const otherOfficers = existingOfficers.filter(o => o.active !== false && o.card_uid !== targetKey)
  const currentOccupants = otherOfficers.filter(o => o.position === selectedPos)

  // Find limit for current position
  let posLimit = null
  for (const g of POSITION_GROUPS) {
    if (g.positions.includes(selectedPos)) {
      posLimit = g.limit
      break
    }
  }
  const isOverLimit = posLimit !== null && currentOccupants.length >= posLimit

  // ── Save handler ──────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault()
    const rawUid = form.card_uid || ''
    const uid = rawUid.toUpperCase().trim()
    const firstName = form.first_name ? form.first_name.trim() : ''
    const lastName  = form.last_name ? form.last_name.trim() : ''
    const position  = form.position || ALL_POSITIONS[0]

    if (!firstName || !lastName) return toast.error('First and last name are required.')

    if (uid && existingOfficers.some(o=>nfcUid(o)===uid && o.card_uid!==targetKey)) return toast.error('Card already linked. Edit or restore its existing officer profile.')
    setSaving(true)
    try {
      let photoId = form.photo_url ? form.photo_id : null
      if (photoFile) photoId = await uploadPhoto(photoFile)
      await saveOfficerProfile(targetKey, uid, {
        first_name: firstName, last_name: lastName, position,
        photo_id: photoId,
      }, {create:!isEdit,reactivate:officer?.active === false})

      toast.success(isEdit ? 'Officer profile updated. Card history is linked.' : uid ? 'Officer and card saved.' : 'Officer profile saved without a card.')
      onSave()
    } catch (err) {
      console.error('Save error:', err)
      toast.error(`Error: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="card w-full max-w-lg p-6 space-y-5 animate-slide-up max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-white text-lg">
            {isEdit ? 'Edit or Link Officer' : 'Add or Link Officer'}
          </h2>
          <button id="close-modal-btn" disabled={saving} onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {leaseError && <div role="alert" className="text-amber-300 text-sm">{leaseError}<button className="btn-secondary ml-2" onClick={()=>setLeaseRetry(v=>v+1)}>Retry scanner</button></div>}
        {officer?.active === false && <p className="text-amber-300 text-sm">Saving this profile will restore this inactive officer.</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Photo upload section */}
          <div className="flex flex-col items-center gap-2 p-3 bg-white/2 border border-white/8 rounded-2xl">
            <div className="relative group">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative block rounded-full focus:outline-none focus:ring-2 focus:ring-brand-500/50"
              >
                {photoPreview ? (
                  <img
                    src={photoPreview}
                    alt="Preview"
                    className="w-24 h-24 rounded-full object-cover border-2 border-brand-500/60 shadow-lg group-hover:opacity-90 transition-opacity"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-brand-500/30 to-violet-500/30 border-2 border-brand-500/30 flex items-center justify-center group-hover:border-brand-500/60 transition-colors">
                    <UserCircle className="w-12 h-12 text-brand-400/70" />
                  </div>
                )}
                <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <Camera className="w-6 h-6 text-white" />
                </div>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 w-8 h-8 bg-brand-600 hover:bg-brand-500 rounded-full flex items-center justify-center cursor-pointer transition-colors shadow-lg border border-white/20"
                title="Choose photo"
              >
                <Camera className="w-4 h-4 text-white" />
              </button>
              <input
                ref={fileInputRef}
                id="photo-upload"
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="hidden"
              />
            </div>

            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs text-brand-400 hover:text-brand-300 font-medium"
              >
                {photoPreview ? 'Change Photo' : 'Upload Photo'}
              </button>
              {photoPreview && (
                <>
                  <span className="text-slate-600">·</span>
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          </div>

          {/* NFC Card UID */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="label mb-0" htmlFor="officer-card-uid">NFC Card UID (optional)</label>
              {!linkedCard && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  {enrolling ? 'Tap card on reader to scan' : 'Scanner enrollment inactive'}
                </span>
              )}
            </div>
            <input
              id="officer-card-uid"
              className={`input font-mono transition-all duration-300 ${lastAutoTap ? 'border-emerald-500/70 ring-2 ring-emerald-500/20' : ''}`}
              placeholder="e.g. A1B2C3D4 — or tap card on reader"
              value={form.card_uid}
              onChange={e => { set('card_uid', e.target.value); setLastAutoTap(null) }}
              disabled={Boolean(linkedCard) || saving}
            />
            {!linkedCard && (
              <p className="text-xs mt-1">
                {lastAutoTap
                  ? <span className="text-emerald-400 font-medium">✓ Auto-detected: {lastAutoTap}</span>
                  : <span className="text-slate-500">Optional: tap a card to link it, or save this profile without a card.</span>
                }
              </p>
            )}
          </div>

          {/* Name */}
          {!officer?.card_uid && <OfficerNameCombobox value={identityQuery} officers={existingOfficers} disabled={saving}
            onChange={value => {
              setIdentityQuery(value); setSelectedKey(null)
              const parts=value.trim().split(/\s+/)
              setForm(f=>({...f,first_name:parts.length>1 ? parts.slice(0,-1).join(' ') : value,last_name:parts.length>1 ? parts.at(-1) : '',photo_id:null,photo_url:''}))
              setPhotoPreview(null);setPhotoFile(null)
            }}
            onSelect={profile=>{
              setSelectedKey(profile.card_uid);setIdentityQuery(`${profile.first_name} ${profile.last_name}`)
              setForm(f=>({...f,first_name:profile.first_name,last_name:profile.last_name,position:profile.position,photo_id:profile.photo_id,photo_url:profile.photo_url||''}))
              setPhotoPreview(profile.photo_url||null);setPhotoFile(null)
            }} />}
          {selectedKey && <p className="text-xs text-emerald-300 rounded-lg bg-emerald-500/10 p-3">Linking an existing officer. Imported attendance and future scans will use the same profile.</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="officer-first-name">First Name</label>
              <input id="officer-first-name" className="input" placeholder="Juan"
                value={form.first_name} onChange={e => set('first_name', e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="officer-last-name">Last Name</label>
              <input id="officer-last-name" className="input" placeholder="dela Cruz"
                value={form.last_name} onChange={e => set('last_name', e.target.value)} required />
            </div>
          </div>

          {/* Position */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Council Position</label>
              {posLimit !== null && (
                <span className="text-2xs text-slate-500 font-medium">
                  Limit: {posLimit} officer{posLimit > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <Select
              id="officer-position"
              aria-label="Council position"
              disabled={saving}
              className="input bg-slate-900 border-white/15"
              value={form.position}
              onChange={e => set('position', e.target.value)}
            >
              {!ALL_POSITIONS.includes(form.position) && <option value={form.position}>{form.position}</option>}
              {POSITION_GROUPS.map(group => (
                <optgroup key={group.group} label={group.group} className="bg-slate-900 text-slate-300 font-semibold">
                  {group.positions.map(p => (
                    <option key={p} value={p} className="bg-slate-950 text-slate-100 font-normal">
                      {p}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>

            {/* Warning if position limit is already reached */}
            {isOverLimit && (
              <div className="mt-2 flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  Notice: <strong>{form.position}</strong> is currently assigned to{' '}
                  <strong>{currentOccupants.map(o => `${o.first_name} ${o.last_name}`).join(', ')}</strong> ({currentOccupants.length}/{posLimit} limit).
                </span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" id="cancel-officer-btn" disabled={saving} onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" id="save-officer-btn" disabled={saving} className="btn-primary">
              {saving
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</>
                : <><Save className="w-4 h-4" />{isEdit ? 'Save Changes' : 'Save Officer'}</>
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Officer Card ──────────────────────────────────────────────────────────────
function OfficerCard({ officer, onEdit, onDelete, isAdmin, isArchived }) {
  const { card_uid, first_name, last_name, position, photo_url } = officer
  const status = isArchived ? null : officer.status === 'ON_DUTY' && officer.status_at && dateKey(officer.status_at) === dateKey() && !isDayClosed(dateKey()) ? 'ON_DUTY' : 'OFF_DUTY'
  const initials = `${first_name?.[0] ?? ''}${last_name?.[0] ?? ''}`.toUpperCase()

  return (
    <div className="card-hover p-5 space-y-4 animate-fade-in flex flex-col justify-between">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {photo_url ? (
            <img src={photo_url} alt={first_name}
              className="w-12 h-12 rounded-full object-cover border-2 border-brand-500/40 flex-shrink-0 shadow-md" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-500/40 to-violet-500/40 border border-brand-500/30 flex items-center justify-center text-sm font-bold text-brand-200 flex-shrink-0">
              {initials || <UserCircle className="w-6 h-6" />}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-white truncate text-base leading-tight">
              {first_name} {last_name}
            </p>
            <p className="text-xs text-brand-300/80 font-medium truncate mt-1" title={position}>
              {position}
            </p>
          </div>
        </div>
        {isAdmin && !isArchived && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button id={`edit-${card_uid}`} onClick={() => onEdit(officer)}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-slate-200"
              title={officer.active === false ? "Restore officer" : "Edit officer & photo"}>
              <Pencil className="w-4 h-4" />
            </button>
            <button disabled={officer.active === false} id={`delete-${card_uid}`} onClick={() => onDelete(officer)}
              className="p-2 hover:bg-red-500/15 rounded-lg transition-colors text-slate-400 hover:text-red-400"
              title="Deactivate officer">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-white/5">
        {status ? (
          <span className={status === 'ON_DUTY' ? 'badge-on-duty' : 'badge-off-duty'}>
            <span className={`w-1.5 h-1.5 rounded-full ${status === 'ON_DUTY' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            {officer.active === false ? 'Inactive' : status === 'ON_DUTY' ? 'On Duty' : 'Off Duty'}
          </span>
        ) : (
          <span className="badge-off-duty">Archived</span>
        )}
        <span className="text-xs font-mono text-slate-500 tracking-wider">{nfcUid(officer) || 'No card linked'}</span>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function OfficerRoster() {
  const { isAdmin }                         = useAuth()
  const { semesters, activeSemester }       = useSemester()
  const [selectedSemester, setSelectedSemester] = useState('')
  const [officers, setOfficers]             = useState([])
  const [loading,  setLoading]              = useState(true)
  const [modal,    setModal]                = useState(null) // null | 'add' | officer object
  const [search,   setSearch]               = useState('')
  const [showInactive,setShowInactive] = useState(false)
  const [error,setError] = useState('')
  const [retry,setRetry] = useState(0)
  const [,setClock] = useState(0)
  useEffect(()=>{const timer=setInterval(()=>setClock(v=>v+1),30000);return()=>clearInterval(timer)},[])

  // Check if viewing an archived semester
  const selectedSemObj = semesters.find(s => s.id === selectedSemester)
  const isArchivedView = Boolean(selectedSemObj && selectedSemObj.status === 'ended')

  useEffect(() => {
    if (isArchivedView) {
      setOfficers(selectedSemObj.officer_snapshot || [])
      setLoading(false)
      return
    }

    setLoading(true);setError('')
    recoverAttendance().catch(e=>setError('Could not recover attendance: '+e.message))
    const unsub = watchRecords('officers', {includeInactive:isAdmin}, (rows) => {
      setError('')
      setOfficers(rows)
      setLoading(false)
    }, err => {
      setError('Could not load officers: '+err.message)
      setLoading(false)
    })
    return () => unsub()
  }, [selectedSemester, isArchivedView, selectedSemObj,isAdmin,retry])

  const handleDelete = async (officer) => {
    if (!window.confirm(`Deactivate ${officer.first_name} ${officer.last_name}? Attendance history will be retained. You can restore this officer later.`)) return
    try {
      await deleteRecord('officers', officer.card_uid)
      toast.success('Officer deactivated.')
    } catch (err) {
      toast.error('Delete failed: ' + err.message)
    }
  }

  const visibleOfficers = officers.filter(o=>isArchivedView || showInactive || o.active !== false)
  const filtered = visibleOfficers.filter(o => {
    const q = search.toLowerCase()
    return !q
      || o.first_name?.toLowerCase().includes(q)
      || o.last_name?.toLowerCase().includes(q)
      || o.position?.toLowerCase().includes(q)
      || nfcUid(o)?.toLowerCase().includes(q)
  })

  const onDuty  = visibleOfficers.filter(o => o.active !== false && o.status === 'ON_DUTY' && o.status_at && dateKey(o.status_at) === dateKey() && !isDayClosed(dateKey())).length
  const offDuty = visibleOfficers.length - onDuty

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Users className="w-6 h-6 text-brand-400" />
            Officer Roster
          </h1>
          <p className="text-slate-400 mt-1 text-sm flex items-center gap-2 flex-wrap">
            <span>{officers.length} officer profiles</span>
            {!isArchivedView && (
              <>
                <span>&nbsp;·&nbsp;</span>
                <span className="text-emerald-400 font-medium">{onDuty} on duty</span>
                <span>&nbsp;·&nbsp;</span>
                <span className="text-slate-500">{offDuty} off duty</span>
              </>
            )}
            {activeSemester && !isArchivedView && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-500/15 text-brand-300 border border-brand-500/25 ml-2">
                <GraduationCap className="w-3 h-3" />
                {activeSemester.name}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Semester Selector */}
          {semesters.length > 0 && (
            <div className="flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-brand-400" />
              <Select
                id="roster-semester-select"
                aria-label="Roster semester"
                className="input py-2 px-3 text-xs w-auto bg-slate-900 border-white/15"
                value={selectedSemester}
                onChange={e => setSelectedSemester(e.target.value)}
              >
                <option value="">Current Roster</option>
                {semesters.filter(s => s.status === 'ended').map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} (Archived Snapshot)
                  </option>
                ))}
              </Select>
            </div>
          )}

          {isAdmin && !isArchivedView && (
            <button id="add-officer-btn" onClick={() => setModal('add')} className="btn-primary">
              <Plus className="w-4 h-4" /> Add or Link Officer
            </button>
          )}
        </div>
      </div>

      {/* Archived view notice banner */}
      {isArchivedView && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-center gap-2">
          <Archive className="w-4 h-4 flex-shrink-0" />
          <span>Viewing archived snapshot of officers from <strong>{selectedSemObj?.name}</strong>. This record is preserved for history.</span>
        </div>
      )}

      {error && <div role="alert" className="card p-4 text-red-300">{error}<button className="btn-secondary ml-3" onClick={()=>setRetry(v=>v+1)}>Retry</button></div>}
      {isAdmin && !isArchivedView && <label className="flex gap-2 text-sm text-slate-400"><input type="checkbox" checked={showInactive} onChange={e=>setShowInactive(e.target.checked)} />Show inactive officers (Edit to restore)</label>}
      <input id="officer-search" className="input max-w-sm"
        placeholder="Search by name, position, or UID…"
        value={search} onChange={e => setSearch(e.target.value)} />

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mr-3" />
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
          <Users className="w-12 h-12 opacity-20" />
          <p className="text-sm">
            {search
              ? 'No officers match your search.'
              : isArchivedView
                ? 'No snapshot records found for this semester.'
                : 'No officer profiles yet.'}
          </p>
          {!search && isAdmin && !isArchivedView && (
            <button onClick={() => setModal('add')} className="btn-primary mt-2">
              <Plus className="w-4 h-4" /> Add First Officer
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(o => (
            <OfficerCard
              key={o.card_uid}
              officer={o}
              isAdmin={isAdmin}
              isArchived={isArchivedView}
              onEdit={setModal}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {isAdmin && !isArchivedView && <PendingCards onLink={uid=>setModal({pending_card_uid:uid})} />}
      {modal && (
        <OfficerModal
          key={modal === 'add' ? 'new' : modal.card_uid || modal.pending_card_uid}
          officer={modal === 'add' ? null : modal}
          existingOfficers={officers}
          onClose={() => setModal(null)}
          onSave={() => setModal(null)}
        />
      )}
    </div>
  )
}
