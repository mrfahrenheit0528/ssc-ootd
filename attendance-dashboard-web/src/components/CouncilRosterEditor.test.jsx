import './selectTestEnvironment.js'
import React, { useState } from 'react'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CouncilRosterEditor from './CouncilRosterEditor.jsx'
import StartSemesterForm from './StartSemesterForm.jsx'

afterEach(cleanup)
const profiles=[{card_uid:'A',first_name:'Ana',last_name:'Example',position:'Secretary'}, {card_uid:'B',first_name:'Ben',last_name:'Example',position:'Secretary',active:false}]
const positions=[{name:'Secretary',capacity:1,group:'Executive'},{name:'Treasurer',capacity:2,group:'Finance'}]
const members=[{card_uid:'A',position:'Secretary'}]
function Editor({disabled=false,changes=[]}) {
  const [roster,setRoster]=useState(members),[rules,setRules]=useState(positions),[name,setName]=useState('Test Council')
  return <CouncilRosterEditor profiles={profiles} members={roster} positions={rules} name={name} disabled={disabled}
    onMembersChange={value=>{changes.push(value);setRoster(value)}} onPositionsChange={setRules} onNameChange={setName} />
}

test('roster editor includes returning inactive profiles, validates seats, and permits reassignment',async()=>{
  const user=userEvent.setup(),changes=[]
  render(<Editor changes={changes} />)
  await user.click(screen.getByRole('checkbox',{name:/Ben Example/}))
  assert.match(screen.getByRole('alert').textContent,/2 selected, but only 1 allowed/)
  await user.click(screen.getByRole('combobox',{name:'Position for Ben Example'}))
  await user.click(await screen.findByRole('option',{name:'Treasurer'}))
  assert.equal(screen.queryByRole('alert'),null)
  assert.equal(changes.at(-1).find(member=>member.card_uid==='B').position,'Treasurer')
  await user.click(screen.getByRole('checkbox',{name:/Ana Example/}))
  assert.deepEqual(changes.at(-1),[{card_uid:'B',position:'Treasurer'}])
  assert.equal(profiles.length,2,'deselecting does not delete a profile')
})

test('renaming a position moves its selected officers and order is editable',async()=>{
  const user=userEvent.setup(),changes=[]
  render(<Editor changes={changes} />)
  const name=screen.getByRole('textbox',{name:'Position 1 name'})
  await user.clear(name);await user.type(name,'Coordinator')
  assert.equal(changes.at(-1)[0].position,'Coordinator')
  assert.equal(screen.getByRole('button',{name:'Remove position 1'}).disabled,true)
  await user.click(screen.getByRole('button',{name:'Move position 2 up'}))
  assert.equal(screen.getByRole('textbox',{name:'Position 1 name'}).value,'Treasurer')
  await user.clear(screen.getByRole('spinbutton',{name:'Position 2 limit'}))
  assert.equal(screen.queryByRole('alert'),null,'blank limit is unlimited')
})

test('saving state disables council changes',()=>{
  render(<Editor disabled />)
  assert.ok(screen.getAllByRole('checkbox').every(control=>control.disabled))
  assert.ok(screen.getAllByRole('spinbutton').every(control=>control.disabled))
  assert.equal(screen.getByRole('button',{name:'Add position'}).disabled,true)
})

test('a newly typed directory group is reusable from another position without retyping',async()=>{
  const user=userEvent.setup()
  render(<Editor />)
  const first=screen.getByRole('combobox',{name:'Position 1 group'})
  await user.clear(first);await user.type(first,'Representatives')
  const second=screen.getByRole('combobox',{name:'Position 2 group'})
  await user.click(second)
  await user.click(screen.getByRole('option',{name:'Representatives'}))
  assert.equal(second.value,'Representatives')
  assert.equal(screen.queryByRole('listbox'),null)
  await user.click(screen.getByRole('button',{name:'Add position'}))
  await user.click(screen.getByRole('combobox',{name:'Position 3 group'}))
  assert.equal(screen.getAllByRole('option',{name:'Representatives'}).length,1,'repeated group names appear once')
  await user.click(screen.getByRole('option',{name:'Representatives'}))
  assert.equal(screen.getByRole('combobox',{name:'Position 3 group'}).value,'Representatives')
})

test('directory groups support filtering, keyboard selection, dismissal, and saving locks',async()=>{
  const user=userEvent.setup()
  const {rerender}=render(<Editor />)
  const second=screen.getByRole('combobox',{name:'Position 2 group'})
  await user.clear(second);await user.type(second,'Exec')
  await user.keyboard('{ArrowDown}{Enter}')
  assert.equal(second.value,'Executive')
  await user.clear(second);await user.keyboard('{ArrowDown}{Enter}')
  assert.equal(second.value,'Executive','keyboard selection works from an empty group field')
  await user.click(second);await user.keyboard('{Escape}')
  assert.equal(screen.queryByRole('listbox'),null)
  await user.click(second)
  await user.click(screen.getByRole('heading',{name:'Positions & officer limits'}))
  assert.equal(screen.queryByRole('listbox'),null,'clicking outside the field dismisses the portalled menu')
  rerender(<Editor disabled />)
  assert.ok(screen.getAllByRole('combobox',{name:/Position \d group/}).every(control=>control.disabled))
})

const term={id:'first',name:'First semester',start_date:'2026-01-01',end_date:'2026-06-01',status:'ended',council_name:'Existing Council',
  roster_managed:true,positions_configured:true,position_config:positions,officer_snapshot:[{...profiles[0],serving:true}]}
const loadProfiles=async()=>profiles
test('semester form carries a council forward through the semester-aware creation API',async()=>{
  const user=userEvent.setup(),calls=[]
  render(<StartSemesterForm semesters={[term]} loadProfiles={loadProfiles} startSemester={async value=>calls.push(value)} />)
  await screen.findByText('1 officers will continue serving.')
  await user.type(screen.getByLabelText('Semester name'),'Second semester')
  await user.click(screen.getByRole('button',{name:'Start Semester'}))
  assert.equal(calls.length,1)
  assert.equal(calls[0].mode,'continue')
  assert.equal(calls[0].sourceSemesterId,'first')
  assert.equal(calls[0].name,'Second semester')
})

test('new-council creation uses the reviewed roster and blocks overcapacity',async()=>{
  const user=userEvent.setup(),calls=[]
  render(<StartSemesterForm semesters={[term]} loadProfiles={loadProfiles} startSemester={async value=>calls.push(value)} />)
  await user.type(screen.getByLabelText('Semester name'),'New term')
  await user.click(screen.getByRole('radio',{name:/New council/}))
  await user.click(screen.getByRole('checkbox',{name:/Ben Example/}))
  assert.equal(screen.getByRole('button',{name:'Start Semester'}).disabled,true)
  await user.click(screen.getByRole('checkbox',{name:/Ana Example/}))
  await user.click(screen.getByRole('button',{name:'Start Semester'}))
  assert.equal(calls.length,1)
  assert.equal(calls[0].mode,'new')
  assert.deepEqual(calls[0].members,[{card_uid:'B',position:'Secretary'}])
  assert.equal(term.officer_snapshot[0].card_uid,'A','preparing a new council never mutates the source roster')
})
