# Correct November 16's earlier automatic 9 PM records

The new rule was activated at **November 16, 2026, 10:53 PM Asia/Manila**.
Schema migrations preserve older clock-ins and already-created automatic
clock-outs. Running the policy/cache migrations again will not rewrite those
records and is unnecessary.

To apply the new estimate to the existing November 16 records, open
[20261116_correct_automatic_clockouts.sql](../supabase/maintenance/20261116_correct_automatic_clockouts.sql)
and run its entire contents in a **new Supabase SQL Editor query**.
Then refresh Live Kiosk and refresh/refetch History, Calendar or Analytics.

This is a targeted data correction, outside the schema migrations directory.
It applies only to November 16's untouched automatic CLOCK_OUT rows at exactly
9 PM whose stable UUID verifies the original clock-in. Entries through 5 PM
become 5 PM; later entries receive one hour after clock-in, only after that hour
is due. Rows already at the correct time are skipped.

Actual clock-outs, admin-edited or deleted records, other dates and the policy
activation setting remain unchanged. An intervening real event makes a visit
ineligible, so ambiguous sessions require individual review rather than a
blanket change. Linked records are marked as audited edits while retaining
their automatic/estimated label. The pending-card estimates are also corrected.
Old reader upload retries cannot overwrite the corrected timestamps.

The script stores before/after snapshots in the private
`attendance_maintenance.clockout_corrections` table and records linked changes
in the attendance audit. Dashboard/anonymous accounts have no access to the
private backup schema. The final result shows the saved previous and corrected
times. Re-running this correction does not apply a second change or duplicate
the audit; the result still lists the saved corrections.

Do not run the database reset scripts, change the policy activation time, or
clear the office PC cache for this correction. The separately supplied reader
update remains necessary for matching future local/offline behavior; installing
it does not itself rewrite these older records.
