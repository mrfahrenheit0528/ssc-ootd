# Automatic clock-out policy

Run [202611160002_automatic_clockout_policy.sql](../supabase/migrations/202611160002_automatic_clockout_policy.sql)
once in **Supabase > SQL Editor**, after the Live Kiosk photos migration, then
refresh the dashboard. No office PC reinstall or cache reset is required.
This upgrade keeps accounts, real attendance, existing corrections and history.

The policy applies to clock-ins timestamped at or after SQL activation, in
**Asia/Manila**. Earlier clock-ins retain the original 9 PM closure rule.

| Clock-in | When automatic closure becomes due | Estimated clock-out |
| --- | --- | --- |
| 9 AM | 9 PM | 5 PM |
| Exactly 5 PM | 9 PM | 5 PM (zero recorded hours) |
| 6 PM | 9 PM | 7 PM |
| 8:30 PM | 9:30 PM | 9:30 PM |
| 11:30 PM | 12:30 AM next day | 12:30 AM next day |

A real clock-out keeps its actual time. The 9 PM waiting window also applies
to late arrivals: someone clocking in at 6 PM can still record a real 8 PM
clock-out. Only a missing clock-out becomes the 7 PM estimate at 9 PM.
If the estimated hour ends after 9 PM, processing waits until that hour ends.
If a real scan arrives late from an
offline queue, it supersedes the automatic estimate; the estimate is retained
as an audited tombstone for linked officers. Automatic times are labeled
**Auto-closed - estimated** in the dashboard and identified in reports.
Admins can correct these estimates with a reason in Log History.

Attendance fulfillment/absences still finalize at 9 PM. A late visit with an
hour still remaining stays open, with no recorded duration, until its own
deadline. A one-hour closure crossing midnight belongs to the clock-in date
in history, calendar reports, exports and analytics.

## Existing office reader

Supabase is authoritative for uploaded records. The upgrade accepts the existing
reader's stable automatic-event UUIDs, converts its 9 PM uploads to the correct
estimate, and acknowledges retries without duplicating or overwriting corrected
records. If an old reader submits a closure before the late hour is finished,
Supabase acknowledges a private receipt and waits until the deadline to create
the attendance event. It never credits a future clock-out in advance.

Processing runs during existing reader context polls (normally every 30 seconds)
and report recovery/refresh. There is no new independent cloud timer in this
migration. If nothing is connected, due visits are recovered on the next
connection or report refresh rather than at an exact wall-clock second.

The installed reader still has its original local 9 PM behavior when offline;
it cannot learn a different offline rule from a server-only update. Uploaded
data is normalized after reconnecting. The old reader's local 9 PM cutoff can
also prevent a physical clock-out after 9 PM; an admin can correct that visit's
actual time in Log History. The server still grants the specified one-hour
automatic estimate to late clock-ins, including those whose hour ends after
9 PM. Changing the reader's offline or after-9-PM scan behavior would require
a reader update, which this upgrade does not install.

Unlinked cards follow the same automatic policy and remain excluded from
officer analytics until linked. Linking preserves the original visit and its
automatic source reference. Private receipts and policy helper functions are
not accessible to dashboard accounts or anonymous requests.
