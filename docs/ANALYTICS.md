# Attendance Analytics

Admins can open **Analytics** from the sidebar (`/analytics`). The page defaults
to the active semester. Choose an archived semester, a custom date range, or a
recent-period shortcut to analyze another period. Dates stay within the selected
semester; All semesters allows an unrestricted custom period (up to ten years).
Use **Analyze attendance** after editing dates and **Refresh report** to fetch
new uploads or corrections. The displayed time identifies the report snapshot;
this page does not poll for changes in the background.

For one school date, set **Analysis view > Single day**, choose **Date**, then
click **Analyze day**. Cards, charts, the officer breakdown and CSV export all
use that day in Asia/Manila. **Today** selects this view automatically; **Last 7
days** and **Last 30 days** return to Date range. You can also choose Date range
to enter From and To manually. Semester boundaries still apply.

If imported visits appear as voluntary with little or no required attendance,
check the calendar's historical assignments. Follow [SCHEDULE_HISTORY.md](SCHEDULE_HISTORY.md)
to apply the intended weekly schedule to the whole semester, then refresh this
report. Existing visits and recorded hours are retained; re-import is unnecessary.

The report includes animated summary cards, an interactive attendance trend,
finalized attendance by weekday, record-quality insights, and a searchable officer
table. Select an officer to expand visit details. The default **Highest attendance
rate** view shows assigned attendees and volunteers; officers with only absences,
pending duties or no attendance are excluded. Volunteers without required duties
retain a blank required-attendance percentage. **Most absences** shows only
officers with missed required duties on finalized dates; pending duties do not
count as absences. **Most recorded hours** sorts the full officer list by time.
View selection and search affect only the table and its CSV export; the overview
always represents the whole period.
The export contains all matching officers, including those on other table pages.
The Analytics route and sidebar entry require an admin account.

## How numbers are calculated

- **Attendance fulfillment:** assigned officer-days attended divided by required
  officer-days on finalized dates. A school day finalizes at 9 PM in Asia/Manila.
  Multiple visits on one day fill only one duty slot. A recorded clock-in proves
  attendance; no minimum duration or lateness rule is applied.
- **Pending duties:** assigned officers without a clock-in on dates that have not
  finalized. Pending slots and all open-day slots are excluded from the rate.
  With no finalized required duties, the rate shows a dash.
- **Officers who attended:** distinct officer profiles with a clock-in in the period.
  Visits count clock-in sessions, so repeat visits can exceed the officer count.
  An NFC card is optional: imported logbook entries and later linked card scans
  use one profile. Unknown-card events appear only after an admin links them.
- **Voluntary attendance:** distinct officer/date combinations without a required
  assignment. No Classes and Optional days require nobody and create no absences.
- **Recorded hours:** summed paired clock-in/out durations. Automatic 9 PM
  clock-outs are included and disclosed. Open visits and unpaired clock-outs add
  no time. This measures recorded time rather than verified hours worked.
  It helps describe total time contributed alongside attendance fulfillment;
  long visits do not fill other duty dates. Guessed logbook times make mock
  hours illustrative rather than evidence of actual work.
- **Record review:** incomplete visits after cutoff and unpaired clock-outs are
  reported separately. An unpaired clock-out cannot satisfy required attendance.

Archived semesters use their saved roster and schedule versions. Inactive or
former officers with assignments or recorded attendance remain visible. Future
and deleted tap events do not count. Long date ranges combine consecutive dates
into at most 24 chart bars without discarding totals; bar details show the covered
dates. Trend counts represent officer-days, rather than unique people across the
entire period. Current-day presence can appear in the trend before finalization.

## Implementation and verification

`utils/attendanceAnalytics.js` aggregates the existing report/calendar rules.
`components/AttendanceAnalytics.jsx` presents the results; `pages/Analytics.jsx`
handles authorized routing context, date validation, loading, errors, refresh,
and generation guards so an older request cannot replace a newer report.
Analytics is loaded as a separate page chunk. Existing Supabase tables and
permissions are sufficient; no additional migration is required.

The UI reuses shared dropdowns, cards, and button styles. Entrance animations,
counting totals, growing chart bars, and the fulfillment ring respect reduced
motion. Chart details work with mouse, keyboard focus, and touch selection.
Run `npm test` for aggregation and DOM interaction tests, and `npm run build`
for production compilation. DOM tests do not replace browser layout review.
