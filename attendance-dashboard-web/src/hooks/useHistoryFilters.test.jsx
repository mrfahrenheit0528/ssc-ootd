import '../components/selectTestEnvironment.js'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useHistoryFilters } from './useHistoryFilters.js'

afterEach(cleanup)
const active = {id:'current',name:'Current term',start_date:'2026-11-01',end_date:null,status:'active'}
const archived = {id:'past',name:'Previous term',start_date:'2026-06-01',end_date:'2026-10-31',status:'ended'}
const defaults = {semesters:[active,archived],activeSemester:active,loading:false,error:'',today:'2026-11-11'}

test('waits for asynchronous semester metadata and loads the active semester by default',async()=>{
  const requests=[]
  const load=(...args)=>requests.push(args)
  const view=renderHook(props=>useHistoryFilters({...props,load}),{initialProps:{...defaults,semesters:[],activeSemester:null,loading:true}})
  assert.equal(requests.length,0)
  view.rerender(defaults)
  await waitFor(()=>assert.deepEqual(requests,[['2026-11-01','2026-11-11','current']]))
  assert.equal(view.result.current.semesterId,'current')
})

test('date edits and quick presets retain the selected semester and its date boundaries',()=>{
  const requests=[]
  const view=renderHook(()=>useHistoryFilters({...defaults,load:(...args)=>requests.push(args)}))
  act(()=>view.result.current.setFrom('2026-11-05'))
  assert.equal(view.result.current.semesterId,'current')
  assert.equal(requests.length,1,'editing the date waits for Fetch Logs')
  act(()=>view.result.current.applyPreset(30))
  assert.deepEqual(requests.at(-1),['2026-11-01','2026-11-11','current'])
  assert.equal(view.result.current.semesterId,'current')
  act(()=>view.result.current.applyPreset(1))
  assert.deepEqual(requests.at(-1),['2026-11-10','2026-11-10','current'])
})

test('explicit archived choices survive ordinary metadata refreshes and reject non-overlapping presets',()=>{
  const requests=[]
  const load=(...args)=>requests.push(args)
  const view=renderHook(props=>useHistoryFilters({...props,load}),{initialProps:defaults})
  act(()=>view.result.current.chooseSemester('past'))
  assert.deepEqual(requests.at(-1),['2026-06-01','2026-10-31','past'])
  view.rerender({...defaults,semesters:[{...active},{...archived}],activeSemester:{...active}})
  assert.equal(view.result.current.semesterId,'past')
  assert.equal(requests.length,2)
  let applied
  act(()=>{applied=view.result.current.applyPreset(0)})
  assert.equal(applied,false)
  assert.equal(requests.length,2)
})

test('switching the active semester updates the filter and loads its matching date range',()=>{
  const requests=[]
  const load=(...args)=>requests.push(args)
  const view=renderHook(props=>useHistoryFilters({...props,load}),{initialProps:defaults})
  const next={id:'next',start_date:'2026-11-11',end_date:null,status:'active'}
  view.rerender({...defaults,semesters:[{...active,status:'ended'},next],activeSemester:next})
  assert.equal(view.result.current.semesterId,'next')
  assert.deepEqual(requests.at(-1),['2026-11-11','2026-11-11','next'])
})

test('no active semester uses an explicit all-semesters fallback and metadata failures do not query attendance',()=>{
  const requests=[]
  const load=(...args)=>requests.push(args)
  const view=renderHook(props=>useHistoryFilters({...props,load}),{initialProps:{...defaults,activeSemester:null,error:'Could not load semesters'}})
  assert.equal(requests.length,0)
  view.rerender({...defaults,activeSemester:null,error:''})
  assert.equal(view.result.current.semesterId,'')
  assert.deepEqual(requests,[['2026-11-11','2026-11-11','']])
})
