# Live Kiosk and unlinked NFC cards

Live Kiosk shows today's linked attendance and unknown-card attendance together.
An unknown card appears under its actual NFC UID with an **Unlinked card** label,
clock-in/out times, and an On Duty status while its latest event is a clock-in.
Unlinked cards count in **Attendees Today**, **Currently On Duty**, and **Clocked
Out**. Their identity has not yet been verified as an officer profile.

These scans stay excluded from officer Analytics, Log History, reports and
calendar fulfillment until an admin links the card. In **Officer Roster >
Unlinked card scans**, choose **Link card** and select/create the intended
profile. The live board then uses that officer's name and retains original event
IDs/timestamps. A linked scan appears once, and corrected/deleted records are
not restored from pending receipts.

## Enable this upgrade once

1. Complete the four earlier migrations if needed.
2. Run the whole [202611150001_live_unlinked_cards.sql](../supabase/migrations/202611150001_live_unlinked_cards.sql)
   file once in a new Supabase SQL Editor query. Do not rerun earlier files.
3. Refresh the updated dashboard and open Live Kiosk. An existing unknown scan
   from today should now appear. No reader restart or re-import is needed.

The kiosk is available only to approved signed-in members. The new scoped RPC
returns today's nondeleted, nonfuture events and a limited set of live-display
fields. It exposes no pending archive history, source device IDs, or linking
metadata. The raw pending table and card-linking workflow stay admin-only.

The board uses Realtime updates plus a five-second snapshot fallback. The fallback
lets approved officer accounts receive unknown-card updates without reading the
admin-only archive. One database statement combines linked and unlinked events,
so card promotion cannot temporarily double-count a scan. JSON aggregation keeps
the snapshot complete beyond the API's ordinary row limit. The displayed school
date follows the server snapshot (Asia/Manila).

Enrollment-window taps still only fill the officer form; they do not create an
attendance visit. Offline reader events appear on the web kiosk after upload.
