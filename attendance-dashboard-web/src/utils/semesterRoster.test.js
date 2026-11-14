import assert from 'node:assert/strict'
import { test } from 'node:test'
import { councilIssues, councilMembers, councilPositions, semesterRoster } from './semesterRoster.js'
import { directoryOfficers, officerGroups } from './directoryOrder.js'
import { buildAttendanceAnalytics } from './attendanceAnalytics.js'
import { emptyWeek } from './attendance.js'
import { fetchAttendanceContext } from './reportExport.js'

const profiles = [
  { card_uid:'A',first_name:'Ana',last_name:'Example',position:'Secretary',nfc_uid:'1234',status:'ON_DUTY',active:true },
  { card_uid:'B',first_name:'Ben',last_name:'Example',position:'Representative',active:true },
]
const first={id:'first',start_date:'2026-01-01',end_date:'2026-06-01',status:'ended',roster_managed:true,positions_configured:true,
  officer_snapshot:[{...profiles[0],position:'Treasurer',serving:true}],position_config:[{name:'Treasurer',capacity:3,group:'Finance'}]}
const second={id:'second',start_date:'2026-06-02',status:'active',roster_managed:true,positions_configured:true,
  officer_snapshot:[{...profiles[0],position:'Secretary',serving:true},{...profiles[1],serving:false}],
  position_config:[{name:'Secretary',capacity:1,group:'Executive'},{name:'Representative',capacity:4,group:'Legislative'}]}

test('each semester uses its own positions and identity snapshot while retaining card status',()=>{
  const old=semesterRoster(first,profiles), current=semesterRoster(second,profiles)
  assert.equal(old[0].position,'Treasurer')
  assert.equal(current[0].position,'Secretary')
  assert.equal(current[0].status,'ON_DUTY')
  assert.equal(current[1].active,false)
  assert.deepEqual(councilMembers(second),[{card_uid:'A',position:'Secretary'}])
})

test('admin-defined position order and groups drive the weekly directory independently of old defaults',()=>{
  const term={...second,officer_snapshot:profiles,position_config:[second.position_config[1],second.position_config[0]]}
  const ordered=directoryOfficers(semesterRoster(term,profiles))
  assert.deepEqual(ordered.map(profile=>profile.card_uid),['B','A'])
  assert.deepEqual(officerGroups(ordered).map(group=>group.label),['Legislative','Executive'])
  const definitions=councilPositions(term)
  definitions[0].capacity=99
  assert.equal(term.position_config[0].capacity,4,'editing a draft cannot mutate the previous semester')
  const interleaved=[{...ordered[0],position_order:0,position_group:'Executive'}, {...ordered[1],position_order:1,position_group:'Finance'}, {...ordered[0],card_uid:'C',position_order:2,position_group:'Executive'}]
  const groups=officerGroups(directoryOfficers(interleaved))
  assert.deepEqual(groups.flatMap(group=>group.officers).map(profile=>profile.card_uid),['B','A','C'])
  assert.equal(new Set(groups.map(group=>group.key)).size,3)
})

test('migration defaults derive counts from the existing roster and keep directory order until configured',()=>{
  const positions=councilPositions({...second,positions_configured:false,officer_snapshot:profiles,position_config:[{name:'Representative',capacity:1},{name:'Secretary',capacity:1}]})
  assert.equal(positions[0].name,'Secretary')
  assert.equal(positions[0].capacity,1)
  assert.deepEqual(councilPositions(null,[profiles[0],{...profiles[1],active:false}]).map(position=>position.name),['Secretary'])
})

test('capacity validation supports custom seats, zero vacancies, unlimited positions, and unique membership',()=>{
  const members=profiles.map(profile=>({card_uid:profile.card_uid,position:'Custom role'}))
  assert.equal(councilIssues(members,[{name:'Custom role',capacity:2}],'Council').length,0)
  assert.equal(councilIssues(members,[{name:'Custom role',capacity:null}],'Council').length,0)
  assert.match(councilIssues(members,[{name:'Custom role',capacity:1}],'Council').join(' '),/2 selected/)
  assert.equal(councilIssues([],[{name:'Vacant role',capacity:0}],'Council').length,0)
  assert.match(councilIssues([members[0],members[0]],[{name:'Custom role',capacity:null}],'Council').join(' '),/only once/)
  assert.match(councilIssues(members,[{name:'Custom role',capacity:2},{name:'custom role',capacity:null}],'Council').join(' '),/unique/)
})

test('analytics respects the selected semester roster and keeps historical positions after reassignment',()=>{
  const versions=[first,second].map(term=>({semester_id:term.id,revision:1,schedule:{...emptyWeek(),1:{type:'scheduled',required_uids:['A']}}}))
  const context={selectedSemesterId:first.id,semesters:[first,second],scheduleVersions:versions,calendarDays:[],officers:profiles,officerMap:Object.fromEntries(profiles.map(profile=>[profile.card_uid,profile]))}
  const old=buildAttendanceAnalytics({context,dateFrom:'2026-05-04',dateTo:'2026-05-04',now:new Date('2026-11-15T12:00:00+08:00')})
  assert.deepEqual(old.officers.map(profile=>[profile.uid,profile.position,profile.absentDays]),[['A','Treasurer',1]])
  const current=buildAttendanceAnalytics({context:{...context,selectedSemesterId:second.id},dateFrom:'2026-11-09',dateTo:'2026-11-09',now:new Date('2026-11-15T12:00:00+08:00')})
  assert.deepEqual(current.officers.map(profile=>[profile.uid,profile.position,profile.absentDays]),[['A','Secretary',1]])
})

test('approved member reports resolve semester identities when the admin-only profile table returns no rows',async()=>{
  const records={calendar_days:[],semester_schedules:[],officers:[],semesters:[first,second]}
  const context=await fetchAttendanceContext('first',[],async table=>records[table])
  assert.equal(context.officers.length,1)
  assert.equal(context.officers[0].position,'Treasurer')
  assert.equal(context.officerMap.A.position,'Treasurer')
  assert.equal(context.officers.some(profile=>profile.card_uid==='B'),false)
})
