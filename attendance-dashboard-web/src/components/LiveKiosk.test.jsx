import './selectTestEnvironment.js'
import React from 'react'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render, screen, within } from '@testing-library/react'
import { LiveKioskBoard } from '../pages/LiveKiosk.jsx'

afterEach(cleanup)
const uid='UNKNOWN1234'
const event=(id,type,time)=>({id,card_uid:`unlinked:${uid}`,nfc_uid:uid,officer_name:null,type,timestamp:`2026-11-15T${time}+08:00`,is_unlinked:true})
const entered=event('pending-in','CLOCK_IN','09:00:00'),exited=event('pending-out','CLOCK_OUT','10:00:00')
const props={dayKey:'2026-11-15',connected:true,loading:false,error:'',onRetry:()=>{}}
const stat=label=>screen.getByText(label).parentElement

test('an unlinked clock-in appears by NFC UID and contributes to the live on-duty counts',()=>{
  render(<LiveKioskBoard {...props} logs={[entered]} />)
  assert.ok(screen.getByText(uid))
  assert.ok(screen.getByText('Unlinked card'))
  assert.ok(screen.getByText('On Duty'))
  assert.ok(within(stat('Attendees Today')).getByText('1'))
  assert.ok(within(stat('Currently On Duty')).getByText('1'))
  assert.ok(within(stat('Clocked Out')).getByText('0'))
  assert.ok(screen.getByText(/stay out of officer analytics/))
})

test('an unlinked clock-out completes the same session and clears its on-duty count',()=>{
  render(<LiveKioskBoard {...props} logs={[exited,entered]} />)
  assert.equal(screen.getAllByText(uid).length,1)
  assert.ok(screen.getByText('1 session'))
  assert.equal(screen.queryByText('On Duty'),null)
  assert.ok(within(stat('Currently On Duty')).getByText('0'))
  assert.ok(within(stat('Clocked Out')).getByText('1'))
})

test('the next linked snapshot replaces the unknown identity with the officer name exactly once',()=>{
  const view=render(<LiveKioskBoard {...props} logs={[entered]} />)
  const linked={...entered,card_uid:'OFF'+'A'.repeat(32),officer_name:'Ana Cruz',is_unlinked:false}
  view.rerender(<LiveKioskBoard {...props} logs={[linked]} />)
  assert.ok(screen.getByText('Ana Cruz'))
  assert.equal(screen.queryByText('Unlinked card'),null)
  assert.ok(screen.getByText(uid))
  assert.ok(screen.getByText('1 session'))
  assert.ok(within(stat('Currently On Duty')).getByText('1'))
  assert.ok(within(stat('Attendees Today')).getByText('1'))
})
