import React, { useEffect, useState } from 'react'
import { GraduationCap, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import Select from './Select'
import CouncilRosterEditor from './CouncilRosterEditor'
import { OfficerModal } from '../pages/OfficerRoster'
import { listRecords, startSemesterCouncil } from '../data'
import { addDateDays, dateKey } from '../utils/attendanceTime'
import { councilIssues, councilMembers, councilPositions, servingMembers } from '../utils/semesterRoster'

export default function StartSemesterForm({ semesters, onStarted, loadProfiles = listRecords, startSemester = startSemesterCouncil }) {
  const previous = [...semesters].filter(term => term.status === 'ended').sort((a,b) => b.start_date.localeCompare(a.start_date))
  const [sourceId,setSourceId] = useState(previous[0]?.id || '')
  const source = previous.find(term => term.id === sourceId)
  const [mode,setMode] = useState(source ? 'continue' : 'new')
  const [name,setName] = useState('')
  const latestEnd = semesters.map(term=>term.end_date || '').sort().at(-1)
  const [startDate,setStartDate] = useState(latestEnd && latestEnd >= dateKey() ? addDateDays(latestEnd,1) : dateKey())
  const [profiles,setProfiles] = useState([])
  const [draft,setDraft] = useState({name:source?.council_name || 'New SSC Council',members:councilMembers(source),positions:councilPositions(source)})
  const [saving,setSaving] = useState(false)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [retry,setRetry] = useState(0)
  const [adding,setAdding] = useState(false)
  useEffect(()=>{
    let cancelled=false
    setLoading(true);setError('')
    loadProfiles('officers',{includeInactive:true}).then(rows=>{if(!cancelled) setProfiles(rows)})
      .catch(error=>{if(!cancelled)setError('Could not load officer profiles: '+error.message)})
      .finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[loadProfiles,retry])
  const issues = mode === 'new' ? councilIssues(draft.members,draft.positions,draft.name) : []
  const handleStart = async () => {
    if (!name.trim() || !startDate || issues.length || (mode === 'continue' && !source)) return
    setSaving(true);setError('')
    try {
      await startSemester({id:`sem_${crypto.randomUUID()}`,name:name.trim(),startDate,mode,sourceSemesterId:sourceId || null,members:draft.members,
        positions:draft.positions.map(position=>({...position,name:position.name.trim(),group:(position.group||'').trim()})),councilName:draft.name.trim()})
      toast.success(`Semester "${name.trim()}" started.`);onStarted?.()
    } catch(error) {
      setError(error.code === 'PGRST202' ? 'Apply the semester councils SQL migration before starting a semester.' : 'Could not start semester: '+error.message)
    } finally {setSaving(false)}
  }
  return <div className="card p-6 space-y-5 border-brand-500/20 bg-brand-500/5">
    <h2 className="font-semibold text-white flex items-center gap-2"><Plus className="w-4 h-4 text-brand-400" />Start a New Semester</h2>
    <div className="grid sm:grid-cols-2 gap-4">
      <label><span className="label">Semester name</span><input id="semester-name" className="input" value={name} disabled={saving} maxLength={200} placeholder="e.g. 2nd Semester AY 2026–2027" onChange={event=>setName(event.target.value)} /></label>
      <label><span className="label">Start date</span><input id="semester-start-date" type="date" className="input" min={latestEnd ? addDateDays(latestEnd,1) : undefined} value={startDate} disabled={saving} onChange={event=>setStartDate(event.target.value)} /></label>
    </div>
    {previous.length>0 && <>
      <label className="block"><span className="label">Previous council</span><Select aria-label="Previous council" value={sourceId} disabled={saving} onChange={event=>{
        const next=previous.find(term=>term.id===event.target.value)
        setSourceId(event.target.value);setDraft({name:next.council_name,members:councilMembers(next),positions:councilPositions(next)})
      }}>{previous.map(term=><option key={term.id} value={term.id}>{term.name} · {term.council_name}</option>)}</Select></label>
      <fieldset className="grid sm:grid-cols-2 gap-3" disabled={saving}><legend className="label">Who will serve this semester?</legend>
        <label className={`p-4 rounded-xl border cursor-pointer ${mode==='continue' ? 'border-brand-500/50 bg-brand-500/10' : 'border-white/10'}`}><span className="flex gap-2 font-medium text-sm"><input type="radio" name="council-mode" value="continue" checked={mode==='continue'} onChange={()=>setMode('continue')} />Same council</span><span className="block text-xs text-slate-400 mt-2">Carry forward the officers, their positions, and position limits.</span></label>
        <label className={`p-4 rounded-xl border cursor-pointer ${mode==='new' ? 'border-brand-500/50 bg-brand-500/10' : 'border-white/10'}`}><span className="flex gap-2 font-medium text-sm"><input type="radio" name="council-mode" value="new" checked={mode==='new'} onChange={()=>setMode('new')} />New council</span><span className="block text-xs text-slate-400 mt-2">Choose returning officers, change positions, and add new officers.</span></label>
      </fieldset>
    </>}
    {mode === 'continue' ? <div className="rounded-xl p-4 bg-emerald-500/5 border border-emerald-500/15 space-y-2"><p className="font-semibold text-emerald-300">{source?.council_name}</p><p className="text-sm text-slate-300">{servingMembers(source).length} officers will continue serving.</p><p className="text-xs text-slate-400">You can adjust this semester’s council in Officer Roster later. Earlier semesters keep their own roster.</p></div> :
      <CouncilRosterEditor profiles={profiles} {...draft} disabled={saving || loading} onNameChange={name=>setDraft(value=>({...value,name}))} onMembersChange={members=>setDraft(value=>({...value,members}))} onPositionsChange={positions=>setDraft(value=>({...value,positions}))} onAddOfficer={()=>setAdding(true)} />}
    {error && <div role="alert" className="text-sm text-red-300">{error}<button type="button" className="btn-secondary ml-3" onClick={()=>setRetry(value=>value+1)}>Retry profiles</button></div>}
    <button id="start-semester-btn" type="button" className="btn-primary" disabled={saving || loading || Boolean(error) || !name.trim() || !startDate || issues.length>0} onClick={handleStart}><GraduationCap className="w-4 h-4" />{saving ? 'Starting…' : 'Start Semester'}</button>
    {adding && <OfficerModal existingOfficers={profiles} currentMembers={draft.members.map(member=>({...member,active:true}))} positions={draft.positions} onClose={()=>setAdding(false)} onSave={profile=>{
      setProfiles(rows=>[...rows.filter(row=>row.card_uid!==profile.card_uid),profile])
      setDraft(value=>({...value,members:[...value.members.filter(member=>member.card_uid!==profile.card_uid),{card_uid:profile.card_uid,position:profile.position}]}));setAdding(false)
    }} />}
  </div>
}
