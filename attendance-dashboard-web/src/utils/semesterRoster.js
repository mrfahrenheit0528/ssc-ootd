import { directoryOfficers, officerGroups } from './directoryOrder.js'

export const servingMembers = semester => (semester?.officer_snapshot ?? []).filter(member => member.serving !== false)
export function semesterRoster(semester, profiles = []) {
  if (!semester?.roster_managed) return profiles
  const registry = new Map(profiles.map(profile => [profile.card_uid, profile]))
  return (semester.officer_snapshot ?? []).map(member => {
    const index = (semester.position_config ?? []).findIndex(position => position.name === member.position)
    const position = semester.position_config?.[index]
    return { ...registry.get(member.card_uid), ...member, active: member.serving !== false,
      ...(semester.positions_configured ? { position_order: index < 0 ? 10000 : index, position_group: position?.group || 'Council positions' } : {}) }
  })
}
export function councilPositions(semester, profiles = []) {
  if (semester?.positions_configured) return semester.position_config.map(position => ({ ...position }))
  const members = semester ? servingMembers(semester) : profiles.filter(profile => profile.active !== false)
  const definitions = semester?.position_config?.length ? semester.position_config : [...new Set(members.map(member => member.position).filter(Boolean))].map(name => ({name}))
  const rules = new Map(definitions.map(position => [position.name, position]))
  const ordered = directoryOfficers(definitions.map(position => ({card_uid:position.name,first_name:'',last_name:'',position:position.name})))
  return officerGroups(ordered).flatMap(group => group.officers.map(officer => ({
    name: officer.position, group: rules.get(officer.position).group || group.label,
    capacity: rules.get(officer.position).capacity ?? members.filter(member => member.position === officer.position).length,
  })))
}
export const councilMembers = semester => servingMembers(semester).map(member => ({card_uid:member.card_uid,position:member.position}))
export function councilIssues(members, positions, name) {
  const issues=[]
  if (!name.trim() || name.length>150) issues.push('Enter a term name (up to 150 characters).')
  const names=positions.map(position=>position.name.trim().toLowerCase())
  if (names.some(name=>!name) || new Set(names).size!==names.length) issues.push('Use a unique name for each position.')
  if (new Set(members.map(member=>member.card_uid)).size!==members.length) issues.push('Select each officer only once.')
  for (const position of positions) {
    if (position.capacity!==null && (!Number.isInteger(position.capacity) || position.capacity<0 || position.capacity>99999)) issues.push(`Set a valid capacity for ${position.name || 'each position'}.`)
    const count=members.filter(member=>member.position===position.name).length
    if (position.capacity!==null && count>position.capacity) issues.push(`${position.name}: ${count} selected, but only ${position.capacity} allowed.`)
  }
  if (members.some(member=>!positions.some(position=>position.name===member.position))) issues.push('Choose a configured position for every selected officer.')
  return issues
}
