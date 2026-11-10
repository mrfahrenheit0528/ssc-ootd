# Attendance Analytics

Admins can open **Analytics** from the sidebar (`/analytics`). The page defaults
to the active semester. Choose an archived semester, a custom date range, or a
recent-period shortcut to analyze another period. Dates stay within the selected
semester; All semesters allows an unrestricted custom period (up to ten years).
Use **Analyze attendance** after editing dates and **Refresh report** to fetch
new uploads or corrections. The displayed time identifies the report snapshot;
this page does not poll for changes in the background.

The report includes animated summary cards, an interactive attendance trend,
finalized attendance by weekday, record-quality insights, and a searchable officer
table. Select an officer to expand visit details. Search and sorting affect only
the table and its CSV export; the overview always represents the whole period.
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
- **Officers who attended:** distinct card UIDs with a clock-in in the period.
  Visits count clock-in sessions, so repeat visits can exceed the officer count.
- **Voluntary attendance:** distinct officer/date combinations without a required
  assignment. No Classes and Optional days require nobody and create no absences.
- **Recorded hours:** summed paired clock-in/out durations. Automatic 9 PM
  clock-outs are included and disclosed. Open visits and unpaired clock-outs add
  no time. This measures recorded time rather than verified hours worked.
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
