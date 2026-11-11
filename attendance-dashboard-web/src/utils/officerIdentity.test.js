import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nfcUid } from './officerIdentity.js'
import { buildAttendanceAnalytics } from './attendanceAnalytics.js'

test('profiles without cards never display generated keys as NFC IDs',()=>{
  const key='OFF'+'A'.repeat(32)
  assert.equal(nfcUid({card_uid:key,nfc_uid:null}),null)
  assert.equal(nfcUid(undefined,key),null)
  assert.equal(nfcUid({card_uid:key,nfc_uid:'BBBB2222'}),'BBBB2222')
  assert.equal(nfcUid({card_uid:'AAAA1111'}),'AAAA1111')
})

test('paper attendance and later scans aggregate under one profile after linking a card',()=>{
  const key='OFF'+'A'.repeat(32)
  const officer={card_uid:key,nfc_uid:'BBBB2222',first_name:'Sample',last_name:'Officer'}
  const logs=['2020-09-01','2020-09-02'].flatMap(day=>[
    {id:day+'in',card_uid:key,type:'CLOCK_IN',timestamp:day+'T09:00:00+08:00'},
    {id:day+'out',card_uid:key,type:'CLOCK_OUT',timestamp:day+'T17:00:00+08:00'},
  ])
  const result=buildAttendanceAnalytics({logs,dateFrom:'2020-09-01',dateTo:'2020-09-02',context:{officers:[officer],officerMap:{[key]:officer}},now:new Date('2026-11-12T12:00:00+08:00')})
  assert.equal(result.officers.length,1)
  assert.equal(result.summary.uniqueAttendees,1)
  assert.equal(result.officers[0].visits,2)
  assert.equal(result.officers[0].seconds,16*3600)
  assert.equal(result.officers[0].nfcUid,'BBBB2222')
})
