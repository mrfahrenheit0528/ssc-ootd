// Position sequence from the council directory. Personal directory data stays
// outside source control; names within a position sort alphabetically.
const clean = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const sections = [
  ['Executive officers', [
    ['President and Student Trustee'],
    ['VPEA', 'Vice President for External Affairs'],
    ['VPIA', 'Vice President for Internal Affairs'],
    ['Secretary'], ['Treasurer'], ['Property Custodian'], ['Auditor'], ['Public Relations Officer'],
    ['SPST', 'Secretary to the President and Student Trustee'],
    ['VSPST', 'Visual Secretary to the President and Student Trustee'],
  ]],
  ['College and campus representatives', [
    ['BUHI Representative', 'Buhi Campus Representatives'],
    ['CAS Representative', 'College of Arts and Sciences CAS Representatives'],
    ['CCS Representative', 'College of Computer Studies CCS Representatives'],
    ['CEA Representative', 'College of Engineering and Architecture CEA Representatives'],
    ['CHS Representative', 'College of Health Sciences CHS Representatives'],
    ['CTDE Representative', 'College of Technological and Developmental Education CTDE Representatives'],
    ['CTHBM Representative', 'College of Tourism Hospitality and Business Management CTHBM Representatives'],
  ]],
  ['Assistant officers', [
    ['Asst. Secretary', 'Assistant Secretary', 'Assistant Secretaries', 'Assistant Secretaries Executive', 'Assistant Secretaries Legislative'],
    ['Asst. Treasurer', 'Assistant Treasurer', 'Assistant Treasurers'],
    ['Asst. Property Custodian', 'Assistant Property Custodian', 'Assistant Property Custodian Officers'],
    ['Asst. Auditor', 'Assistant Auditor', 'Assistant Auditors'],
    ['Asst. Public Relations Officer', 'Assistant Public Relations Officer', 'Assistant Public Relations Officer Documentation', 'Assistant Public Relations Officer Multimedia and Design', 'Assistant Public Relations Officer Technical', 'Assistant Public Relations Officer Publication'],
  ]],
  ['Committee directors', [
    ['Student Rights and Welfare Director', 'Student Rights and Welfare Committee Director'],
    ['Gender and Development Director', 'Gender and Development Committee Director'],
    ['Sports and Cultural Director', 'Sports and Cultural Committee Director'],
    ['Environmental Concerns Director', 'Environmental Concerns Committee Director'],
  ]],
]
const positionIndex = new Map()
let rank = 0
for (const [group, positions] of sections) for (const aliases of positions) {
  for (const alias of aliases) positionIndex.set(clean(alias), { group, rank })
  rank++
}
const descriptor = officer => Number.isInteger(officer.position_order)
  ? {group:officer.position_group || 'Council positions',rank:officer.position_order}
  : positionIndex.get(clean(officer.position)) ?? { group: 'Other officers', rank }
export function directoryOfficers(officers, selected = []) {
  const chosen = new Set(selected)
  return officers.filter(officer => officer.active !== false || chosen.has(officer.card_uid)).slice().sort((a, b) =>
    descriptor(a).rank - descriptor(b).rank
    || (descriptor(a).rank === rank ? clean(a.position).localeCompare(clean(b.position)) : 0)
    || clean(a.first_name).localeCompare(clean(b.first_name))
    || clean(a.last_name).localeCompare(clean(b.last_name))
    || a.card_uid.localeCompare(b.card_uid))
}
export function officerGroups(officers, query = '') {
  const search = clean(query), groups = []
  for (const officer of officers) {
    const { group } = descriptor(officer)
    if (search && !clean(`${officer.first_name} ${officer.last_name} ${officer.position} ${group}`).includes(search)) continue
    if (groups.at(-1)?.label !== group) groups.push({label:group,key:`${group}-${groups.length}`,officers:[]})
    groups.at(-1).officers.push(officer)
  }
  return groups
}
