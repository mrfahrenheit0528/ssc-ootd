import assert from 'node:assert/strict'
import { test } from 'node:test'
import { directoryOfficers, officerGroups } from './directoryOrder.js'

const officer = (id, position, first_name = id) => ({ card_uid: id, position, first_name, last_name: 'Example' })
test('directory positions follow executives, representatives, assistants, then committee directors', () => {
  const input = [officer('director', 'Sports and Cultural Committee Director'), officer('assistant-audit', 'Asst. Auditor'),
    officer('audit', 'Auditor'), officer('cas', 'College of Arts and Sciences (CAS) Representatives'), officer('property', 'Property Custodian'),
    officer('assistant-property', 'Asst. Property Custodian'), officer('president', 'President and Student Trustee'),
    officer('vpea', 'Vice President for External Affairs'), officer('other', 'Officer')]
  assert.deepEqual(directoryOfficers(input).map(row => row.card_uid), ['president', 'vpea', 'property', 'audit', 'cas', 'assistant-property', 'assistant-audit', 'director', 'other'])
  assert.equal(input[0].card_uid, 'director', 'sorting must not mutate the fetched roster')
})
test('search and alphabetical ties retain selected inactive officers and include profiles without cards', () => {
  const input = [officer('z', 'Assistant Secretary', 'Zoe'), { ...officer('a', 'Asst. Secretary', 'Ana'), nfc_uid: null },
    { ...officer('old', 'Secretary'), active: false }, { ...officer('hidden', 'Treasurer'), active: false }]
  const ordered = directoryOfficers(input, ['old'])
  assert.deepEqual(ordered.map(row => row.card_uid), ['old', 'a', 'z'])
  assert.deepEqual(officerGroups(ordered, 'secretary').flatMap(group => group.officers).map(row => row.card_uid), ['old', 'a', 'z'])
  assert.equal(officerGroups(ordered, 'ANA')[0].officers[0].card_uid, 'a')
})
