# Officer photos in Live Kiosk

Apply this upgrade to the existing Supabase project after the semester councils
migration. It does not clear attendance, change accounts, or alter the reader.

1. Open [202611160001_live_kiosk_photos.sql](../supabase/migrations/202611160001_live_kiosk_photos.sql).
2. Copy the entire file into a new query in **Supabase → SQL Editor** and run it.
3. Refresh the hosted dashboard.
4. Upload/update an officer's photo through **Officer Roster** as an admin.
5. When that officer has attendance today, check **Live Kiosk** with an admin or
   approved officer account.

Both mobile and desktop show the uploaded photo. A missing or unreadable photo
falls back to the first letter of the officer's name. Unlinked cards always use
`?`, with the NFC UID beside the avatar.

The live snapshot carries photo IDs, not image bytes. The browser retrieves
uncached images through `live_kiosk_photos` and reuses them across visits and
polls. A failed image lookup leaves attendance visible and retries on a later
poll. Replacing/removing an officer's photo is reflected on the next live refresh.

The photo RPC requires approved membership and returns only requested photos
belonging to identified officers with a nondeleted attendance event today, up to
the current time in Asia/Manila. It does not expose unlinked identities, future
or historical attendance photos, or the full officer photo table. Full photo
table reads and changes remain admin-only.

Until the SQL upgrade runs, the dashboard continues showing initials and `?`.
This upgrade needs no reader reinstall or configuration change.
