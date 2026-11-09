import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeAttendanceData, resolveDay, emptyWeek } from './attendance.js'
import { dateKey,dateBounds,timeInput } from './attendanceTime.js'
const week={...emptyWeek(),1:{type:'scheduled',required_uids:['A']},2:{type:'scheduled',required_uids:['A']}}
const context={semesters:[{id:'term',start_date:'2026-11-01',end_date:'2026-12-01',status:'active'}],scheduleVersions:[{id:'v1',semester_id:'term',revision:1,schedule:week}],calendarDays:[]}
const officerMap={A:{first_name:'Ana',last_name:'Cruz'},B:{first_name:'Ben',last_name:'Diaz'}}
const tap=(uid,type='CLOCK_IN',day='2026-11-09')=>({id:uid+type+day,card_uid:uid,officer_name:uid==='A'?'Ana Cruz':'Ben Diaz',type,timestamp:`${day}T09:00:00+08:00`})
const analyze=options=>analyzeAttendanceData({dateFrom:'2026-11-09',dateTo:'2026-11-10',context,officerMap,now:new Date('2026-11-11T10:00:00+08:00'),...options})
test('a volunteer cannot fill another officer required slot',()=>{
  const d=analyze({logs:[tap('B')]}).dailyReports[0]
  assert.equal(d.requiredAttendedCount,0);assert.equal(d.requiredAbsentCount,1);assert.equal(d.voluntaryOfficersCount,1);assert.equal(d.status,'absent')
})
test('missing override assignments inherit but explicit empty list clears them',()=>{
  const c={...context,calendarDays:[{semester_id:'term',date:'2026-11-09',type:'regular'}]}
  assert.deepEqual(resolveDay('2026-11-09',c).required_uids,['A'])
  c.calendarDays[0].required_uids=[]
  assert.deepEqual(resolveDay('2026-11-09',c).required_uids,[])
})
test('search runs after pairing and absence analysis and scopes required totals',()=>{
  const result=analyze({logs:[tap('A'),tap('A','CLOCK_OUT'),tap('B')],search:'Ben'})
  assert.equal(result.summary.totalRequiredAbsent,0);assert.equal(result.summary.totalRequiredAssignments,0)
  assert.equal(result.allMasterRows.length,1);assert.equal(result.allMasterRows[0].status,'Incomplete')
})
test('zero-tap days are included and future/current unclosed assignments stay pending',()=>{
  const result=analyze({logs:[],now:new Date('2026-11-09T10:00:00+08:00')})
  assert.equal(result.dailyReports.length,2);assert.equal(result.summary.totalPendingAssignments,2)
  assert.equal(result.summary.totalRequiredAbsent,0);assert.equal(result.summary.overallFulfillmentRate,null)
  assert.equal(analyze({logs:[]}).summary.totalRequiredAbsent,2)
})
test('calendar No Classes and Optional suppress required absences',()=>{
  for(const type of ['no_classes','optional']) {
    const result=analyze({logs:[],context:{...context,calendarDays:[{semester_id:'term',date:'2026-11-09',type}]}})
    assert.equal(result.dailyReports[0].requiredCount,0)
  }
})
test('historical days resolve their frozen revision while newer dates use the latest',()=>{
  const c={...context,scheduleVersions:[...context.scheduleVersions,{id:'v2',semester_id:'term',revision:2,schedule:{...week,1:{type:'scheduled',required_uids:['B']}}}],calendarDays:[{semester_id:'term',date:'2026-11-09',type:'regular',schedule_version_id:'v1'}]}
  assert.deepEqual(resolveDay('2026-11-09',c).required_uids,['A'])
  assert.deepEqual(resolveDay('2026-11-16',c).required_uids,['B'])
})
test('orphan clock-outs are flagged and cannot prove assigned attendance',()=>{
  const result=analyze({logs:[tap('A','CLOCK_OUT')]})
  assert.equal(result.dailyReports[0].requiredAttendedCount,0)
  assert.ok(result.allMasterRows.some(r=>r.status==='Needs Review'))
})
test('school dates and time seconds do not depend on the browser timezone',()=>{
  assert.equal(dateKey('2026-11-09T18:30:42Z'),'2026-11-10')
  assert.equal(timeInput('2026-11-09T18:30:42Z'),'02:30:42')
  assert.deepEqual(dateBounds('2026-11-10'),{from:'2026-11-10T00:00:00+08:00',until:'2026-11-11T00:00:00+08:00'})
})

test('searching one of two assigned attendees cannot invent the hidden attendee absence',()=>{
  const ctx={...context,scheduleVersions:[{id:'v1',semester_id:'term',revision:1,schedule:{...week,1:{type:'scheduled',required_uids:['A','B']}}}]}
  const result=analyze({context:ctx,dateTo:'2026-11-09',logs:[tap('A'),tap('B')],search:'Ana'})
  assert.equal(result.summary.totalRequiredAssignments,1)
  assert.equal(result.summary.totalRequiredAbsent,0)
  assert.equal(result.allMasterRows.length,1)
})
