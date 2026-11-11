import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Upload, X, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react'
import Select from './Select'
import { IMPORT_HEADERS, officerName, parseAttendanceCSV, previewAttendanceImport, validImportDate } from '../utils/attendanceImport'
import { serializeCSV } from '../utils/csv'
import { dateBounds, dateKey } from '../utils/attendanceTime'

// Inject data operations so file review can be tested without a live account.
export default function AttendanceImportModal({ semesters, initialSemesterId, loadOfficers, loadExisting, importRows, onClose, onImported }) {
  const [semesterId, setSemesterId] = useState(initialSemesterId ?? '')
  const [officers, setOfficers] = useState([])
  const [rows, setRows] = useState([])
  const [filename, setFilename] = useState('')
  const [reason, setReason] = useState('Paper OOTD logbook transcription')
  const [error, setError] = useState('')
  const [rosterError, setRosterError] = useState('')
  const [rosterLoading, setRosterLoading] = useState(true)
  const [existingState, setExistingState] = useState({ key: '', logs: [], loading: false, error: '' })
  const [rosterRetry, setRosterRetry] = useState(0)
  const [previewRetry, setPreviewRetry] = useState(0)
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [page, setPage] = useState(0)
  const fileGeneration = useRef(0)
  const inputRef = useRef(null)
  const semester = semesters.find(term => term.id === semesterId)
  useEffect(() => {
    let stopped = false
    setRosterLoading(true); setRosterError('')
    loadOfficers().then(value => { if (!stopped) setOfficers(value) }).catch(e => { if (!stopped) setRosterError(e.message) })
      .finally(() => { if (!stopped) setRosterLoading(false) })
    return () => { stopped = true }
  }, [loadOfficers, rosterRetry])
  const dates = rows.filter(row => validImportDate(row.date) && semester && row.date >= semester.start_date
    && (!semester.end_date || row.date <= semester.end_date) && row.date <= dateKey()).map(row => row.date).sort()
  const from = dates[0], to = dates.at(-1)
  const scope = from && to && semesterId ? `${semesterId}|${from}|${to}` : ''
  useEffect(() => {
    let stopped = false
    if (!scope) { setExistingState({ key: '', logs: [], loading: false, error: '' }); return }
    setExistingState({ key: scope, logs: [], loading: true, error: '' })
    loadExisting(dateBounds(from, to)).then(logs => { if (!stopped) setExistingState({ key: scope, logs, loading: false, error: '' }) })
      .catch(e => { if (!stopped) setExistingState({ key: scope, logs: [], loading: false, error: e.message }) })
    return () => { stopped = true }
  }, [scope, previewRetry, loadExisting])
  useEffect(() => () => { fileGeneration.current++ }, [])
  const previews = useMemo(() => previewAttendanceImport(rows, { officers, semester, existing: existingState.logs }), [rows, officers, semester, existingState.logs])
  const chosen = previews.filter(row => row.included)
  const ready = chosen.filter(row => !row.issues.length && !row.duplicate)
  const invalid = chosen.filter(row => row.issues.length)
  const duplicates = chosen.filter(row => !row.issues.length && row.duplicate)
  const checking = rosterLoading || existingState.loading || (scope && existingState.key !== scope)
  const canImport = Boolean(semester && ready.length && !invalid.length && !checking && !rosterError && !existingState.error && !saving && !receipt)
  const edit = (index, patch) => { setRows(old => old.map((row, i) => i === index ? { ...row, ...patch } : row)); setError('') }
  const readFile = async event => {
    const file = event.target.files?.[0]
    if (!file) return
    const generation = ++fileGeneration.current
    setRows([]); setError(''); setFilename(''); setPage(0); setReceipt(null)
    try {
      if (file.size > 1024 * 1024) throw new Error('Use a CSV file under 1 MB.')
      const parsed = parseAttendanceCSV(await file.text())
      if (generation !== fileGeneration.current) return
      setRows(parsed.map(row => ({ ...row, source: row.source || `${file.name} row ${row.rowNumber}` })))
      setFilename(file.name)
    } catch (e) { if (generation === fileGeneration.current) setError(e.message) }
    finally { if (inputRef.current) inputRef.current.value = '' }
  }
  const template = () => {
    const url = URL.createObjectURL(new Blob([serializeCSV([IMPORT_HEADERS])], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a'); link.href = url; link.download = 'ootd_import_template.csv'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const save = async () => {
    if (!canImport) return
    if (reason.trim().length < 3 || reason.length > 1000) { setError('Enter an import reason (3-1000 characters).'); return }
    setSaving(true); setError('')
    try {
      const result = await importRows(semesterId, ready.map(row => row.payload), reason.trim())
      setReceipt({ ...result, previewSkipped: duplicates.length })
      onImported()
    } catch (e) {
      const message = String(e.message ?? e).replace(/^Row (\d+):/, (_, index) => `CSV row ${ready[Number(index) - 1]?.rowNumber ?? index}:`)
      setError(e.code === 'PGRST202' ? 'CSV import is not installed yet. Run the new attendance CSV import SQL migration in Supabase, then retry.' : `${message} Batches are atomic. If the connection was interrupted, retry safely; duplicate sessions will be skipped.`)
      setPreviewRetry(value => value + 1)
    } finally { setSaving(false) }
  }
  const pages = Math.max(1, Math.ceil(rows.length / 15))
  return <div role="dialog" aria-modal="true" aria-labelledby="import-title" className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 animate-fade-in">
    <div className="card bg-slate-900 w-full max-w-6xl max-h-[92vh] overflow-auto p-5 sm:p-6 space-y-5 animate-slide-up">
      <div className="flex items-center justify-between gap-3"><h2 id="import-title" className="text-lg text-white font-semibold flex items-center gap-2"><Upload className="w-5 h-5 text-brand-400" />Import paper attendance</h2><button aria-label="Close CSV import" onClick={onClose} disabled={saving} className="p-2 rounded-lg hover:bg-white/10"><X className="w-5 h-5" /></button></div>
      <p className="text-sm text-slate-400">One CSV row per complete visit: date, name or card UID, time-in, and time-out. School time is Asia/Manila. Missing or uncertain details need review; signatures are source notes only.</p>
      {receipt ? <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-3"><p className="text-emerald-300 flex items-center gap-2"><CheckCircle2 className="w-5 h-5" />Imported {receipt.imported_sessions} sessions ({receipt.inserted_events} events). Skipped {receipt.skipped_sessions + receipt.previewSkipped} duplicates.</p><p className="text-sm text-slate-400">Imported entries are marked as edited and have an audit record. Choose the matching dates or semester in Log History to view them.</p><button onClick={onClose} className="btn-primary">Done</button></div> : <>
        <div className="grid sm:grid-cols-2 gap-4"><div><label className="label" htmlFor="import-semester">Import into semester</label><Select id="import-semester" value={semesterId} disabled={saving} onChange={e => { setSemesterId(e.target.value); setError('') }}><option value="">Select a semester</option>{semesters.map(term => <option key={term.id} value={term.id}>{term.name}{term.status === 'ended' ? ' (Archived)' : ''}</option>)}</Select></div>
          <div className="flex flex-wrap items-end gap-2"><input ref={inputRef} type="file" accept=".csv,text/csv" aria-label="Attendance CSV file" onChange={readFile} disabled={saving || rosterLoading || Boolean(rosterError)} className="input flex-1 min-w-48 file:mr-3 file:border-0 file:rounded-md file:bg-brand-500/15 file:text-brand-300 file:px-3 file:py-1" /><button className="btn-secondary" onClick={template} disabled={saving}><Download className="w-4 h-4" />Template</button></div></div>
        <p className="text-xs text-slate-500">Use YYYY-MM-DD and HH:mm (24-hour), or an explicit AM/PM time. Both events must be on the same day. Maximum 500 rows; a failed batch saves nothing.</p>
        {rosterError && <div role="alert" className="text-sm text-red-300">Could not load officers: {rosterError}<button className="btn-secondary ml-3" onClick={() => setRosterRetry(value => value + 1)}>Retry officers</button></div>}
        {existingState.error && <div role="alert" className="text-sm text-red-300">Could not check duplicates: {existingState.error}<button className="btn-secondary ml-3" onClick={() => setPreviewRetry(value => value + 1)}>Retry duplicate check</button></div>}
        {error && <div role="alert" className="text-sm text-red-300 rounded-xl bg-red-500/10 p-3">{error}</div>}
        {checking && <p role="status" className="text-sm text-slate-400 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" />{rosterLoading ? 'Loading enrolled officers…' : 'Checking existing attendance…'}</p>}
        {rows.length > 0 && <>
          <div className="flex gap-3 flex-wrap items-center text-xs text-slate-400"><span className="font-medium text-slate-200">{filename}</span><span>{rows.length} rows</span><span className="text-emerald-300">{ready.length} ready</span><span className="text-amber-300">{invalid.length} need review</span><span>{duplicates.length} duplicates skipped</span><span>{rows.length - chosen.length} excluded</span><button className="btn-secondary text-xs" disabled={saving || checking} onClick={() => setRows(old => old.map((row, index) => ({ ...row, included: previews[index].issues.length === 0 && !previews[index].duplicate })))}>Select ready rows</button></div>
          <div className="table-wrapper max-h-[42vh]"><table className="data-table min-w-[1000px]"><thead><tr>{['Include', 'CSV row / name', 'Matched officer', 'Date', 'Time-in', 'Time-out', 'Review'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
            {previews.slice(page * 15, page * 15 + 15).map((row, offset) => { const index = page * 15 + offset; return <tr key={row.rowNumber}>
              <td><input type="checkbox" aria-label={`Include row ${row.rowNumber}`} checked={row.included} disabled={saving} onChange={e => edit(index, { included: e.target.checked })} /></td>
              <td className="max-w-56"><p className="text-xs text-slate-500">Row {row.rowNumber}</p><p className="text-sm">{row.name || row.card_uid}</p><p className="text-xs text-slate-500 break-words" title={row.notes}>{row.source}</p>{row.raw_time_in && <p className="text-xs text-slate-500">Written in: {row.raw_time_in}</p>}{row.raw_time_out && <p className="text-xs text-slate-500">Written out: {row.raw_time_out}</p>}</td>
              <td><Select aria-label={`Officer for row ${row.rowNumber}`} className="w-56" value={row.officer?.card_uid ?? ''} disabled={saving} onChange={e => { const officer = officers.find(o => o.card_uid === e.target.value); edit(index, { card_uid: e.target.value, name: officer ? officerName(officer) : row.name }) }}><option value="">Choose officer</option>{officers.map(officer => <option key={officer.card_uid} value={officer.card_uid}>{officerName(officer)}{officer.active === false ? ' (Inactive)' : ''}</option>)}</Select></td>
              <td><input aria-label={`Date for row ${row.rowNumber}`} className="input w-36" type="date" disabled={saving} value={row.date ?? ''} onChange={e => edit(index, { date: e.target.value })} /></td>
              <td><input aria-label={`Time-in for row ${row.rowNumber}`} className="input w-32" placeholder="09:00 AM" disabled={saving} value={row.time_in ?? ''} onChange={e => edit(index, { time_in: e.target.value })} /></td>
              <td><input aria-label={`Time-out for row ${row.rowNumber}`} className="input w-32" placeholder="05:00 PM" disabled={saving} value={row.time_out ?? ''} onChange={e => edit(index, { time_out: e.target.value })} /></td>
              <td className="min-w-56 max-w-72 text-xs"><p className={row.issues.length ? 'text-amber-300' : 'text-emerald-300'}>{row.issues.length ? row.issues.join(' ') : row.duplicate ? 'Duplicate: will be skipped.' : 'Ready to import.'}</p>{row.notes && <p className="text-slate-500 mt-1">{row.notes}</p>}{row.review_status && !['ready', 'confirmed'].includes(row.review_status.toLowerCase()) && <button className="btn-secondary text-xs mt-2" disabled={saving} onClick={() => edit(index, { review_status: 'confirmed' })}>Mark row {row.rowNumber} reviewed</button>}</td>
            </tr> })}
          </tbody></table></div>
          <div className="flex justify-between gap-3 items-center"><p className="text-xs text-slate-500">Names are matched only when unique; uncertain names need your selection. Officers must already be enrolled.</p><div className="flex gap-2 items-center text-xs text-slate-400"><button className="btn-secondary" disabled={saving || page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>{page + 1}/{pages}</span><button className="btn-secondary" disabled={saving || page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button></div></div>
          <div><label htmlFor="import-reason" className="label">Import reason (saved to audit history)</label><textarea id="import-reason" className="input" minLength={3} maxLength={1000} value={reason} disabled={saving} onChange={e => setReason(e.target.value)} /></div>
          {invalid.length > 0 && <p className="text-xs text-amber-300 flex items-center gap-2"><AlertCircle className="w-4 h-4" />Correct or exclude selected rows with issues before importing.</p>}
        </>}
        <div className="flex justify-end gap-3"><button className="btn-secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!canImport} onClick={save}>{saving ? 'Importing…' : `Import ${ready.length} sessions`}</button></div>
      </>}
    </div>
  </div>
}
