# Dashboard review — 10 November 2026

Reviewed application commit: `90cd48e`.

The dashboard builds and its current tests pass, but the review found
correctness gaps to fix before expanding the feature set. This document records
findings; it does not change application behavior or the live Supabase project.

## What was checked

- Authentication context, role checks, protected routes, and the supplied SQL permissions.
- Supabase data access, photo handling, and Realtime subscriptions.
- Live Kiosk, Log History, Officer Roster, Calendar, Day Config, and Semesters.
- CSV/Excel analysis and how search, dates, and schedules affect exports.
- Reader integration where it affects dashboard status and corrections.

Verification completed:

- 16 dashboard tests passed.
- 20 reader tests passed in the reader virtual environment.
- Production build passed, with the existing bundle-size warning.
- Four attendance/schedule/reporting issues below were reproduced by running
  the existing functions with fabricated records.
- The officer-save request was inspected using a fake HTTP transport; no
  production profiles or attendance were changed.

The actual hosted site's current permissions, browser sessions, mobile layout,
and hardware workflow were not verified in this review. The security review
covered repository code and SQL, not live project configuration.

## Fix before adding features

### 1. Calendar fulfillment counts the wrong officers

**Priority: high. Reproduced.**

If A is assigned but only volunteer B clocks in, the calendar shows `Full`
and `1/1`. It compares the number of all attendees with the number required,
instead of counting the assigned officers who actually attended. The drawer
can still list A as absent, contradicting the calendar cell.

Source: [Calendar.jsx](../attendance-dashboard-web/src/pages/Calendar.jsx),
`getDayStatus` and `getAttendanceRatio`.

Fix: calculate fulfillment using the intersection of required UIDs and
attending UIDs. Show volunteers separately. Share that calculation with reports.

### 2. Date overrides can remove the day's assignments

**Priority: high. Reproduced.**

The Day Config form lets an admin leave **Override required officers for this
date** unchecked. It then saves no `required_uids`. However, both day resolvers
use the date record as the complete replacement and do not inherit the weekly
required officers. A regular-day override with just a note can therefore erase
the assignment list used by attendance calculations.

Sources: [DayConfig.jsx](../attendance-dashboard-web/src/pages/DayConfig.jsx),
`DayOverrideModal.handleSave`;
[reportExport.js](../attendance-dashboard-web/src/utils/reportExport.js),
`resolveDay`; and the separate resolver in Calendar.

Fix: distinguish an omitted assignment field, which should inherit, from an
explicit empty list, which means nobody is required. Use one shared resolver.

### 3. Search-filtered exports can invent absences

**Priority: high. Reproduced.**

When A and B are both assigned and both present, searching for A filters B's
logs out of the export input. The report still evaluates the entire required
roster and writes an ABSENT record for B.

Sources: [LogHistory.jsx](../attendance-dashboard-web/src/pages/LogHistory.jsx),
`filtered` and the export handlers;
[reportExport.js](../attendance-dashboard-web/src/utils/reportExport.js),
`analyzeAttendanceData`.

Fix: calculate attendance from the complete fetched dataset, then apply a
consistent officer filter to the resulting report rows and assignment scope.

### 4. CSV and Excel can report different absences

**Priority: high. Reproduced for missing-day calculation; UI guards reviewed.**

CSV does not pass the selected date interval into attendance analysis. It only
includes days that contain logs, so an assigned day with no taps disappears.
Excel supplies the interval and can include that day's absences. Both pages
also block exports entirely when there are no logs, preventing an all-absent
report. Monthly Excel exports include future dates, and the analyzer currently
marks required officers absent on those dates too.

Sources: [reportExport.js](../attendance-dashboard-web/src/utils/reportExport.js),
`allDays` and `exportCSVReport`;
[LogHistory.jsx](../attendance-dashboard-web/src/pages/LogHistory.jsx), export
guards; [Calendar.jsx](../attendance-dashboard-web/src/pages/Calendar.jsx),
monthly export interval and guard.

Fix: use one explicit report scope for CSV and Excel; allow reports with
scheduled duties but no attendance; show future duties as pending rather than absent.

### 5. Weekly schedule changes overwrite schedule history

**Priority: high. Source reviewed.**

Every save replaces the single `day_config/weekly` record. If a new schedule
starts in November, the old October schedule is no longer available. October
reports then fall back to built-in defaults unless individual date overrides
exist. Semester roster snapshots do not preserve the weekly schedule.

Sources: [DayConfig.jsx](../attendance-dashboard-web/src/pages/DayConfig.jsx),
`saveWeeklySchedule`; [reportExport.js](../attendance-dashboard-web/src/utils/reportExport.js),
`resolveDay`.

Fix: retain schedule versions and select the version effective on each date.

### 6. Enrolling an existing card can overwrite its officer profile

**Priority: high. Save-request behavior verified with a fake transport.**

The Add Officer form and Edit Officer form both use the same upsert. Submitting
an existing UID in the Add form replaces the existing profile fields, rather
than reporting that the card is already enrolled. The request explicitly uses
`resolution=merge-duplicates`. Existing photo references can also be cleared.

Sources: [OfficerRoster.jsx](../attendance-dashboard-web/src/pages/OfficerRoster.jsx),
`handleSubmit`; [data.js](../attendance-dashboard-web/src/data.js), `saveRecord`.

Fix: insert new officers with duplicate rejection, and update existing officers
through an explicit edit path. Handle deactivated-card reactivation separately.

## Other reliability gaps

### 7. Edited dates and fetched records can get out of sync

**Priority: medium. Source reviewed.**

Changing From/To dates does not fetch immediately, but exports use the edited
dates with the previously loaded logs. Changing filters while requests are
running can also let an older response replace the latest selection; the
Calendar and History fetches have no request-generation guard.

Sources: [LogHistory.jsx](../attendance-dashboard-web/src/pages/LogHistory.jsx),
date inputs, `fetchRange`, and export handlers;
[Calendar.jsx](../attendance-dashboard-web/src/pages/Calendar.jsx), `fetchData`.

Fix: track the successfully fetched scope separately from draft filter inputs,
disable stale exports, and ignore obsolete responses.

### 8. Cloud corrections and local reader state can disagree

**Priority: high for manual corrections. Source reviewed.**

Adding a manual clock-out changes cloud logs and cloud officer status, but
does not change the reader's SQLite duty state. That reader can still consider
the officer on duty and reject a later clock-in as a repeat tap. Editing logs
also records only `manually_edited`; it does not retain editor identity,
correction reason, or before/after values.

Sources: [LogHistory.jsx](../attendance-dashboard-web/src/pages/LogHistory.jsx),
`LogEditModal.handleSave`;
[state_machine.py](../nfc-daemon-python/state_machine.py), duty decisions;
[supabase_sync.py](../nfc-daemon-python/supabase_sync.py), context refresh;
[initial schema](../supabase/migrations/202611090001_initial.sql), attendance columns.

Fix: add an explicit correction workflow with audit history and a reconciliation
protocol that respects pending offline events.

### 9. Missed cutoffs leave inconsistent or stale duty information

**Priority: medium. Source reviewed; carried forward from the initial audit.**

Automatic clock-out still runs only on the reader PC. If it is off at the
cutoff, there is no startup recovery. The roster uses the stored latest-event
status without checking its date, while the kiosk only queries today's logs.
An officer can remain On Duty in the roster while being absent from today's
kiosk entirely.

Sources: [scheduler.py](../nfc-daemon-python/scheduler.py), job registration;
[db.py](../nfc-daemon-python/db.py), date-scoped state queries;
[OfficerRoster.jsx](../attendance-dashboard-web/src/pages/OfficerRoster.jsx),
status display; [initial schema](../supabase/migrations/202611090001_initial.sql),
`refresh_officer_status`.

Fix: define cutoff recovery and one authoritative duty-state calculation.

### 10. Editing an event discards its seconds

**Priority: medium. Source reviewed.**

The editor loads only `HH:mm` and saves a timestamp ending in `:00`. Even
changing an unrelated flag changes a recorded time such as 09:15:42 to
09:15:00, affecting session duration.

Source: [LogHistory.jsx](../attendance-dashboard-web/src/pages/LogHistory.jsx),
`timeStr` initialization and `handleSave`.

Fix: preserve the original timestamp unless the time changes, or provide a
seconds-capable time input.

### 11. Two enrollment forms can interfere with each other

**Priority: medium. Source reviewed.**

Each form stores an `owner` but neither the save path nor the reader checks
ownership. Closing one tab can clear enrollment while another admin is still
enrolling. Lease expiration and stale-tap checks also rely on the browser clock.

Sources: [OfficerRoster.jsx](../attendance-dashboard-web/src/pages/OfficerRoster.jsx),
enrollment effect; [initial schema](../supabase/migrations/202611090001_initial.sql),
`reader_tap` and `reader_context`.

Fix: acquire, renew, and release an owner-checked lease using database time.

### 12. Errors can look like empty attendance

**Priority: medium. Source reviewed.**

Calendar fetch errors only reach the browser console, and Day Config clears
loading without telling the user that initialization failed. Old or empty data
can therefore be mistaken for a valid attendance result or schedule.

Sources: [Calendar.jsx](../attendance-dashboard-web/src/pages/Calendar.jsx),
`fetchData.catch`; [DayConfig.jsx](../attendance-dashboard-web/src/pages/DayConfig.jsx),
initial load; [SemesterContext.jsx](../attendance-dashboard-web/src/contexts/SemesterContext.jsx),
subscription error handler.

Fix: show a visible error and retry action, distinguish failed loads from empty
results, and block exports until the full required context loads successfully.

## Product decisions and follow-up checks

- **Mobile use:** `App.jsx` reserves a fixed 240-pixel sidebar and margin even
  on small screens. A collapsible mobile navigation layout needs visual testing.
- **Timezone:** dates and report grouping use the viewer's browser timezone,
  while the reader defaults to Asia/Manila. Define an SSC reporting timezone.
- **Officer access:** every approved officer can currently read the entire
  attendance dataset. Confirm that this is the intended viewing policy.
- **Status wording:** Clocked Out currently means unique officers with any
  clock-out today, including someone who later returns. This matches the recent
  requested counting change, but is different from currently off duty.
- **Position limits:** the form warns about occupied positions but does not
  enforce the displayed limits. Decide whether those are warnings or hard rules.
- **Accounts and recovery:** provisioning and role changes are still performed
  in Supabase; there is no in-app password reset or account-management page.
- **Browser verification:** add end-to-end checks for admin/officer navigation,
  enrollment, corrections, filter/export consistency, and connection loss.
- **Free hosting:** verify actual project permissions, independent backup and
  restore procedures, and behavior when Supabase pauses before real reliance.

## Suggested implementation order

1. Correct shared assignment and absence calculations: findings 1–4.
2. Prevent destructive enrollment and preserve schedule history: findings 5–6.
3. Make corrections, fetched scopes, and duty state consistent: findings 7–10.
4. Improve enrollment ownership, error states, and phone usability.
5. Add the next feature after the relevant regression checks pass.
