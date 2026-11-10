import './selectTestEnvironment.js'
import React, { useState } from 'react'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Tabs from './Tabs.jsx'

afterEach(cleanup)
function Draft() {
  const [note,setNote]=useState('')
  return <input aria-label="Weekly draft" value={note} onChange={e=>setNote(e.target.value)} />
}
function Settings() {
  const [value,setValue]=useState('weekly')
  return <Tabs label="Day configuration sections" value={value} onValueChange={setValue} tabs={[
    {value:'weekly',label:'Weekly recurring assignments',content:<Draft />},
    {value:'calendar',label:'Calendar day types',content:<p>Calendar preview</p>},
  ]} />
}

test('tabs show one section at a time and retain unsaved work when switching',async()=>{
  const user=userEvent.setup()
  render(<Settings />)
  assert.equal(screen.getAllByRole('tabpanel').length,1)
  await user.type(screen.getByRole('textbox',{name:'Weekly draft'}),'Unsaved assignment')
  await user.click(screen.getByRole('tab',{name:'Calendar day types'}))
  assert.equal(screen.getByRole('tabpanel').getAttribute('aria-labelledby'),screen.getByRole('tab',{name:'Calendar day types'}).id)
  assert.equal(screen.queryByRole('textbox'),null)
  await user.click(screen.getByRole('tab',{name:'Weekly recurring assignments'}))
  assert.equal(screen.getByRole('textbox').value,'Unsaved assignment')
  assert.equal(screen.getAllByRole('tabpanel').length,1)
})

test('tab keyboard navigation supports arrows, wraparound, Home and End',async()=>{
  const user=userEvent.setup()
  render(<Settings />)
  const weekly=screen.getByRole('tab',{name:'Weekly recurring assignments'})
  const calendar=screen.getByRole('tab',{name:'Calendar day types'})
  await user.tab()
  assert.equal(document.activeElement,weekly)
  await user.keyboard('{ArrowRight}')
  assert.equal(document.activeElement,calendar)
  assert.equal(calendar.getAttribute('aria-selected'),'true')
  assert.equal(weekly.tabIndex,-1)
  await user.keyboard('{ArrowRight}')
  assert.equal(document.activeElement,weekly)
  await user.keyboard('{End}')
  assert.equal(document.activeElement,calendar)
  await user.keyboard('{Home}')
  assert.equal(document.activeElement,weekly)
  await user.keyboard('{ArrowLeft}')
  assert.equal(document.activeElement,calendar)
})
