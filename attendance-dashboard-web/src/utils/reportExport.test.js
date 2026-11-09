import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as XLSX from 'xlsx'
import { exportCSVReport, exportXLSXReport } from './reportExport.js'

const fixture = {
  dateFrom: '2026-10-20',
  dateTo: '2026-10-20',
  officerMap: { TEST01: { first_name: '=1+1', last_name: 'Test', position: 'Member' } },
  logs: [
    { card_uid: 'TEST01', officer_name: '=1+1 Test', type: 'CLOCK_IN', timestamp: '2026-10-20T09:00:00' },
    { card_uid: 'TEST01', officer_name: '=1+1 Test', type: 'CLOCK_OUT', timestamp: '2026-10-20T10:00:00' },
  ],
}

test('CSV download neutralizes a formula in an actual attendance record', async (t) => {
  let downloadBlob
  let clicked = false
  t.mock.method(URL, 'createObjectURL', blob => { downloadBlob = blob; return 'blob:test' })
  t.mock.method(URL, 'revokeObjectURL', () => {})
  const previous = globalThis.document
  globalThis.document = { createElement: () => ({ click() { clicked = true } }) }
  try {
    assert.equal(exportCSVReport(fixture), 1)
    assert.equal(clicked, true)
    const csv = await downloadBlob.text()
    assert.ok(csv.includes('"\'=1+1 Test"'))
    assert.ok(csv.includes('"TEST01"'))
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
})

test('updated SheetJS writes a readable multi-sheet workbook with text cells', () => {
  XLSX.set_fs(fs)
  const originalDirectory = process.cwd()
  const directory = fs.mkdtempSync(join(tmpdir(), 'ssc-export-'))
  let filename
  try {
    process.chdir(directory)
    const result = exportXLSXReport(fixture)
    filename = result.filename
    const workbook = XLSX.read(fs.readFileSync(filename), { type: 'buffer' })
    assert.equal(result.totalRecords, 1)
    assert.equal(result.sheetsCount, 3)
    assert.ok(workbook.SheetNames.includes('2026-10-20'))
    const master = workbook.Sheets['All Records (Master)']
    assert.equal(master.B5.v, '=1+1 Test')
    assert.equal(master.B5.t, 's')
    assert.equal(master.B5.f, undefined)
  } finally {
    process.chdir(originalDirectory)
    if (filename && fs.existsSync(join(directory, filename))) fs.unlinkSync(join(directory, filename))
    fs.rmdirSync(directory)
  }
})

test('CSV and workbook both include an all-absent day without recorded taps',async(t)=>{
  const options={dateFrom:'2026-11-09',dateTo:'2026-11-09',logs:[],officerMap:{A:{first_name:'Ana',last_name:'Cruz'}},context:{semesters:[{id:'term',start_date:'2026-11-01'}],scheduleVersions:[{id:'v1',semester_id:'term',revision:1,schedule:{1:{type:'scheduled',required_uids:['A']}}}]},now:new Date('2026-11-10T12:00:00+08:00')}
  let blob
  t.mock.method(URL,'createObjectURL',value=>{blob=value;return 'blob:test'})
  t.mock.method(URL,'revokeObjectURL',()=>{})
  const previous=globalThis.document
  globalThis.document={createElement:()=>({click(){}})}
  const cwd=process.cwd(),directory=fs.mkdtempSync(join(tmpdir(),'ssc-absent-'))
  let filename
  try {
    assert.equal(exportCSVReport(options),1)
    const csv=await blob.text()
    assert.ok(csv.includes('ABSENT'));assert.ok(csv.includes('Ana Cruz'))
    process.chdir(directory);XLSX.set_fs(fs)
    const result=exportXLSXReport(options);filename=result.filename
    assert.equal(result.totalRecords,1)
    const workbook=XLSX.read(fs.readFileSync(filename),{type:'buffer'})
    assert.equal(workbook.Sheets['All Records (Master)'].F5.v,'ABSENT')
  } finally {
    process.chdir(cwd)
    if(previous===undefined)delete globalThis.document;else globalThis.document=previous
    if(filename&&fs.existsSync(join(directory,filename)))fs.unlinkSync(join(directory,filename))
    fs.rmdirSync(directory)
  }
})
