# Upgrade the dashboard and semester schedules

Use this guide if the original Supabase setup already works on your PC.
The updated code needs **one additional SQL migration** in that same project.
Your existing `.env`, reader registration, and `config.json` stay in place.
Scheduling stays **admin only**. There is no separate secretary sign-in role.

## 1. Finish uploading, then stop both programs

1. Keep the reader connected to the internet until its pending taps upload.
2. In the terminal running the reader, press **Ctrl+C**.
3. In the terminal running the dashboard, press **Ctrl+C** too.
4. Keep your reader's SQLite database. Do not delete it or recreate credentials.

If you have real records you want to keep, make a private database backup first;
see [the backup guide](DEV_SETUP.md#backups). The migration retains attendance,
photos, accounts, and the old configuration. Never commit backups or `.env`.

## 2. Run the NEW SQL file once

**Where: VS Code first, then your Supabase project in your browser.**

1. Open [202611100001_dashboard_refinement.sql](../supabase/migrations/202611100001_dashboard_refinement.sql).
2. Click inside the file, press **Ctrl+A**, then **Ctrl+C**.
3. Open your `ssc-attendance` project in Supabase.
4. Click **SQL Editor** on the left, then **New query**.
5. Paste with **Ctrl+V**, then click **Run**.
6. Wait for success. In **Table Editor**, look for these additional tables:

   | New table | Purpose |
   |---|---|
   | `semester_schedules` | Weekly assignments and their revisions, per semester |
   | `calendar_days` | Regular, No Classes, and Optional dates |
   | `attendance_audit` | Who corrected an entry, why, and its before/after values |

**Do not run `202611090001_initial.sql` again in an existing project.**
If SQL reports `already exists`, stop and check whether the new migration
already completed. The file runs in a transaction: an error rolls its changes
back. Do not delete tables to work around an error; copy the error for debugging.

For a brand-new empty project, run the initial migration first, then this new
migration, before continuing with account and reader setup.

## 3. Start the updated programs

From the repository root, start the reader:

```powershell
.\nfc-daemon-python\.venv\Scripts\python.exe .\nfc-daemon-python\main.py
```

In a second terminal, start the dashboard:

```powershell
cd attendance-dashboard-web
npm.cmd run dev
```

Refresh the website and sign in as an admin. If you host the website online,
redeploy the updated dashboard after the SQL upgrade, and update the Python
files on every reader PC before restarting those readers.

## 4. Choose a semester and assign the weekly officers

1. Open **Semesters**. Create or activate the semester you intend to configure.
2. Open **Day Config** and choose that semester.
3. For each weekday choose **Scheduled** or **Unscheduled**.
4. For a Scheduled day, tick the officers required for that weekday.
5. The calendar immediately previews type and officer changes for today and
   future dates. An amber message identifies unsaved changes. Earlier dates
   retain their saved assignments; No Classes, Optional, and custom date lists
   still take precedence.
6. Click **Save semester schedule** in either card to apply the changes. Save
   weekly edits before opening an individual date so those edits are retained.

There is no Effective From date. The schedule belongs to the selected semester.
The first schedule of a new semester covers that semester. Later saves retain
previous dates' assignments and update today and future dates. Calendar-specific
officer lists continue to take precedence. Archived semesters are read-only;
reactivating one is an explicit admin action.

Existing weekly configuration is imported into existing semesters. Past dates
are preserved using the configuration available at upgrade time. The old system
did not retain overwritten schedules, so the migration cannot reconstruct older
versions that were already lost. Review imported assignments before relying on
historical reports.

## 5. Set day types on the calendar

Scroll to **Calendar day types** in Day Config. Navigate to a month, then click
a date within the selected semester. Choose:

| Day type | What it means |
|---|---|
| Regular | Follow the saved weekly assignments |
| No Classes | No required attendance or absences for the date |
| Optional | Attendance is voluntary; no required absences |

Add a note if helpful, then click **Save day**. Holiday has been removed; existing
Holiday dates become No Classes. Regular is the default for unmarked dates.
Weekly Unscheduled days have no recurring required officers.

Both calendars use **📌 Scheduled** and **➖ Unscheduled** markers, with a legend
and hover labels. The icons indicate the saved schedule; No Classes and Optional
still suppress required attendance. Full labels remain in the schedule forms.

On **Regular** days, normally leave **Use a different officer list for this date**
unchecked: that inherits the weekly officers. Checking it with no officers selected
explicitly means nobody is required.

On **No Classes** and **Optional** days, the checkbox and officer list are hidden.
The form explains that nobody is required and any attendance is voluntary.
Weekly assignments and any existing custom list are retained, so switching the
date back to Regular restores the assignment settings. Saving a non-required day
does not delete those settings.

## 6. Check the corrected behavior

- **Calendar:** a volunteer does not fill an assigned officer's slot. Click a
  date to see assigned, pending, absent, and voluntary records separately.
- **Log History:** a visit still has one row with clock-in and clock-out. Enter
  a reason when adding, changing, or deleting an event. Seconds are preserved.
- **Reports:** fetch the selected range before exporting. CSV and Excel include
  assigned days with no taps. Searching filters the completed analysis, so it
  cannot turn hidden attendees into absentees. Future and unclosed duties are
  Pending; required absences finalize at **9 PM, Asia/Manila**.
- **Officer Roster:** enrolling an existing card produces an error. To restore
  an inactive officer, tick **Show inactive officers**, edit their profile, and
  save. Deactivation retains attendance history.
- **Enrollment:** one admin window owns the scanner lease. Another window cannot
  steal or end that lease. If the reader or internet is unavailable, enter the
  card UID manually; scanner auto-fill requires an active online lease.

An admin can inspect correction history in Supabase **Table Editor >
attendance_audit**, matching `attendance_log_id` to the attendance entry. Approved
officers cannot read this audit table or change schedules, profiles, or logs.

## Recovery and remaining limits

The reader refreshes cloud corrections about every 30 seconds and before a tap,
while keeping events the server has not received. When offline, it continues
using local state; corrections take effect when it reconnects. Upload pending
taps before correcting the same visit where possible, and review overlaps if
someone edited records while a reader was disconnected.

Missed 9 PM clock-outs recover when the reader starts or polls, or when a
connected dashboard loads attendance. Live Kiosk also requests recovery every
30 seconds. Recovery retains the original duty date and uses matching event
IDs to avoid duplicate reader/cloud clock-outs. If all readers and browsers
are closed, recovery waits until one reconnects; there is no always-running
cloud timer in this release. Nothing records new NFC taps while the PC is off.
Keep the PC clock correct. School timezone and cutoff are fixed to Asia/Manila
and 21:00 so reader and cloud calculations agree.

Code and SQL were tested with fabricated data in a disposable local PostgreSQL
instance. Live Supabase permissions, physical NFC behavior, and desktop/mobile
browser layout still need a smoke check after applying the migration. Automated
computer-use verification was unavailable in the development session.
