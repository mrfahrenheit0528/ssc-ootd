import './selectTestEnvironment.js'
import React, { useState } from 'react'
import { test,afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { render,screen,cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OfficerNameCombobox from './OfficerNameCombobox.jsx'
afterEach(cleanup)
const officers=[{card_uid:'OFF'+'A'.repeat(32),nfc_uid:null,first_name:'Ana',last_name:'Cruz',position:'Secretary'},
  {card_uid:'OFF'+'B'.repeat(32),nfc_uid:'BBBB2222',first_name:'Ben',last_name:'Diaz'},
  {card_uid:'OFF'+'C'.repeat(32),nfc_uid:null,first_name:'Cara',last_name:'Reyes',position:'Treasurer'}]
function Form({selected}) {
  const [value,setValue]=useState('')
  return <OfficerNameCombobox value={value} onChange={setValue} officers={officers} onSelect={officer=>{selected.push(officer.card_uid);setValue(`${officer.first_name} ${officer.last_name}`)}} />
}
test('name field supports free text and selects existing profiles without cards by keyboard',async()=>{
  const selected=[],user=userEvent.setup()
  render(<Form selected={selected} />)
  const input=screen.getByRole('combobox',{name:'Officer name'})
  await user.click(input)
  assert.equal(screen.queryByRole('option',{name:/Ben Diaz/}),null)
  await user.type(input,'Ana')
  await user.keyboard('{ArrowDown}{Enter}')
  assert.equal(input.value,'Ana Cruz')
  assert.deepEqual(selected,[officers[0].card_uid])
  assert.equal(input.getAttribute('aria-expanded'),'false')
  await user.clear(input);await user.type(input,'New Person')
  assert.equal(input.value,'New Person')
  assert.match(screen.getByText(/New name/).textContent,/Check the first and last names/)
})
test('up arrow starts at the last available profile and Escape dismisses suggestions',async()=>{
  const selected=[],user=userEvent.setup()
  render(<Form selected={selected} />)
  await user.click(screen.getByRole('combobox'))
  await user.keyboard('{ArrowUp}{Enter}')
  assert.deepEqual(selected,[officers[2].card_uid])
  await user.click(screen.getByRole('combobox'));await user.keyboard('{Escape}')
  assert.equal(screen.queryByRole('listbox'),null)
})
