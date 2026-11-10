import './selectTestEnvironment.js'
import React, { useState } from 'react'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Select from './Select.jsx'

afterEach(cleanup)

function Field({ onChange = () => {}, children, initial = '', ...props }) {
  const [value,setValue] = useState(initial)
  return <Select aria-label="Semester" value={value} onChange={event => {setValue(event.target.value);onChange(event)}} {...props}>{children}</Select>
}

test('mouse selection preserves the empty default and never submits its parent form',async()=>{
  const user = userEvent.setup(), changed = []
  let submits = 0
  const view = render(<form onSubmit={e=>{e.preventDefault();submits++}}>
    <Field name="semester" onChange={e=>changed.push(e.target.value)}>
      <option value="">All semesters</option><option value="current">Current semester</option>
    </Field>
  </form>)
  const trigger = screen.getByRole('combobox',{name:'Semester'})
  assert.match(trigger.textContent,/All semesters/)
  await user.click(trigger)
  await screen.findByRole('listbox')
  assert.equal(within(view.container).queryByRole('listbox'),null,'menu is portalled out of clipping containers')
  await user.click(screen.getByRole('option',{name:'Current semester'}))
  assert.match(trigger.textContent,/Current semester/)
  assert.equal(new window.FormData(view.container.querySelector('form')).get('semester'),'current')
  await user.click(trigger)
  await user.click(await screen.findByRole('option',{name:'All semesters'}))
  assert.deepEqual(changed,['current',''])
  assert.equal(new window.FormData(view.container.querySelector('form')).get('semester'),'')
  assert.equal(submits,0)
})

test('keyboard arrows skip disabled items and Escape restores focus without changing selection',async()=>{
  const user=userEvent.setup(), changed=[]
  render(<Field initial="a" onChange={e=>changed.push(e.target.value)}>
    <option value="a">First semester</option><option value="b" disabled>Unavailable semester</option><option value="c">Third semester</option>
  </Field>)
  const trigger=screen.getByRole('combobox',{name:'Semester'})
  await user.tab()
  await user.keyboard('{Enter}')
  await screen.findByRole('listbox')
  await user.keyboard('{ArrowDown}{Enter}')
  await waitFor(()=>assert.deepEqual(changed,['c']))
  await waitFor(()=>assert.equal(document.activeElement,trigger))
  await user.keyboard('{Enter}')
  await screen.findByRole('listbox')
  await user.keyboard('{Home}{Escape}')
  await waitFor(()=>assert.equal(screen.queryByRole('listbox'),null))
  assert.deepEqual(changed,['c'])
  assert.match(trigger.textContent,/Third semester/)
  assert.equal(document.activeElement,trigger)
})

test('group labels and disabled groups survive the position-picker upgrade',async()=>{
  const user=userEvent.setup()
  render(<Field initial="secretary">
    <optgroup label="Executive Board"><option value="secretary">Secretary</option><option value="treasurer">Treasurer</option></optgroup>
    <optgroup label="Archived positions" disabled><option value="old">Previous office</option></optgroup>
  </Field>)
  await user.click(screen.getByRole('combobox'))
  const group=await screen.findByRole('group',{name:'Executive Board'})
  assert.equal(within(group).getAllByRole('option').length,2)
  assert.equal(screen.getByRole('option',{name:'Previous office'}).getAttribute('aria-disabled'),'true')
  await user.click(screen.getByRole('option',{name:'Treasurer'}))
  assert.match(screen.getByRole('combobox').textContent,/Treasurer/)
})

test('a disabled field cannot open or change',async()=>{
  const user=userEvent.setup(), changed=[]
  render(<Field disabled initial="regular" onChange={e=>changed.push(e.target.value)}><option value="regular">Regular</option><option value="optional">Optional</option></Field>)
  const trigger=screen.getByRole('combobox')
  assert.equal(trigger.disabled,true)
  await user.click(trigger)
  assert.equal(screen.queryByRole('listbox'),null)
  assert.deepEqual(changed,[])
})

test('typeahead finds an officer position and selecting it keeps the original field id',async()=>{
  const user=userEvent.setup(), changed=[]
  render(<Field id="officer-position" initial="president" onChange={e=>changed.push([e.target.id,e.target.value])}>
    <option value="president">President</option><option value="secretary">Secretary</option><option value="treasurer">Treasurer</option>
  </Field>)
  await user.click(screen.getByRole('combobox'))
  await screen.findByRole('listbox')
  await user.keyboard('tre')
  await waitFor(()=>assert.equal(document.activeElement,screen.getByRole('option',{name:'Treasurer'})))
  await user.keyboard('{Enter}')
  assert.deepEqual(changed,[['officer-position','treasurer']])
})

test('controlled fields reflect asynchronous roster and semester updates',async()=>{
  const view=render(<Select aria-label="Semester" value="" onChange={()=>{}}><option value="">Current Roster</option></Select>)
  view.rerender(<Select aria-label="Semester" value="archived" onChange={()=>{}}><option value="">Current Roster</option><option value="archived">Archived snapshot</option></Select>)
  await waitFor(()=>assert.match(screen.getByRole('combobox').textContent,/Archived snapshot/))
})

test('clicking outside a modal dropdown closes it without changing the field',async()=>{
  const user=userEvent.setup(), changed=[]
  render(<div role="dialog" aria-label="Edit day"><Field initial="regular" onChange={e=>changed.push(e.target.value)}>
    <option value="regular">Regular</option><option value="optional">Optional</option>
  </Field><button>Cancel</button></div>)
  await user.click(screen.getByRole('combobox'))
  await screen.findByRole('listbox')
  fireEvent.pointerDown(screen.getByRole('button',{name:'Cancel',hidden:true}),{pointerType:'mouse'})
  await waitFor(()=>assert.equal(screen.queryByRole('listbox'),null))
  assert.deepEqual(changed,[])
})

test('touch interactions can open and select a day type',async()=>{
  const user=userEvent.setup(), changed=[]
  render(<Field initial="regular" onChange={e=>changed.push(e.target.value)}><option value="regular">Regular</option><option value="no_classes">No Classes</option></Field>)
  await user.pointer([{keys:'[TouchA>]',target:screen.getByRole('combobox')},{keys:'[/TouchA]'}])
  const option=await screen.findByRole('option',{name:'No Classes'})
  await user.pointer([{keys:'[TouchA>]',target:option},{keys:'[/TouchA]'}])
  await waitFor(()=>assert.deepEqual(changed,['no_classes']))
  assert.match(screen.getByRole('combobox').textContent,/No Classes/)
})
