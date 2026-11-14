# Import paper OOTD attendance

Admins can open **Log History > Import CSV** to review and import handwritten
logbook sessions. The feature creates attendance entries only after the admin
selects **Import sessions** in the preview. Selecting a file does not save it.

## Install the import and card-linking upgrade once

If both existing migrations already ran, run only the new one:

1. Open [202611120001_attendance_csv_import.sql](../supabase/migrations/202611120001_attendance_csv_import.sql)
   in VS Code and copy the whole file.
2. In your existing Supabase project, open **SQL Editor > New query**.
3. Paste the SQL and click **Run**. Wait for success.
4. Update and restart the Python reader, keeping its configuration and SQLite
   database. Refresh the dashboard and sign in as an admin.

The revised migration adds checked imports, profiles with optional NFC cards,
and pending attendance for unknown cards. Existing officer identities, schedules,
photos, and attendance remain intact. If this file has not been run, use its
current complete contents once. Do not rerun the earlier migrations. For a new
empty project, apply all migrations in filename order.

## Prepare the CSV

Download **Template** in the import dialog. Use one row per complete same-day
visit, with these columns:

| Column | Meaning |
|---|---|
| `date` | Required `YYYY-MM-DD`, within the selected semester |
| `firstname` | Officer's first name(s), including middle initials if used |
| `lastname` | Officer's last name, including suffixes if used |
| `position` | Position for a new profile; defaults to `Officer` if omitted |
| `time_in` | Required `HH:mm` / `HH:mm:ss` in 24-hour time, or `h:mm AM/PM` |
| `time_out` | Required time after time-in, on the same school date |

```csv
date,firstname,lastname,position,time_in,time_out
2020-09-01,Ana Maria,Cruz,Secretary,09:00,17:00
```

These are the only columns in the downloaded template. A combined name, NFC
UID, signature, source, and review-status column are not needed. The preview
combines first/last names to find the existing officer; the position is used
when explicitly creating a missing profile and does not overwrite a matched
officer's profile. Imports still record the filename, CSV row, actor and reason
internally for auditing.

Keep uncertain handwriting readings and source references in separate
transcription notes. The six-column CSV has no embedded review flags: check
those notes and the originals before including estimated entries. Missing
clock-outs must be completed or excluded; they are not replaced with a 9 PM
estimate. `09:00` explicitly means 9 AM.

Older files using `first_name` / `last_name`, a combined `name`, or a `card_uid`
still work. Optional source/review fields in older files retain their validation
and review behavior.

Names are compared without accents, punctuation, single-letter initials, or
word order. Only a unique full-name match is automatic. Abbreviated, partial,
ambiguous names require the admin to choose the intended officer profile.
Inactive officers remain available for historical imports. The directory PDF
helps transcription but does not supply card UIDs. For an unmatched name, choose
**Create profile without a card** and check the separate first/last name fields.
**Create missing profiles without cards** applies that choice to unmatched rows
that already contain both name fields. This choice is explicit; choosing a file
does not create profiles. Several rows for the same normalized name reuse one
profile. Review similarly named people carefully before importing.

## Review and import

1. Choose the correct semester. Archived semesters are allowed for historical
   attendance; importing does not reactivate the term or change its schedule.
2. Choose a UTF-8 CSV under 1 MB, containing no more than 500 sessions.
3. Wait for the officer profile list and existing attendance duplicate check.
4. Review matched names, dates, times, and any separate transcription notes.
   Correct the fields in the preview, or uncheck **Include** for unresolved rows.
   **Select ready rows** excludes all currently invalid and duplicate rows.
5. Confirm each flagged source with **Mark row reviewed** after verifying it.
   Every included row must have complete, valid dates/times and either an officer
   match or an explicitly selected new profile with first and last names.
6. Enter an audit reason and click **Import sessions**.
7. Read the imported/duplicate and created-profile counts. Change Log History's date/semester filter
   if needed to view the imported historical entries.

The server rechecks authorization, term dates, time order, future times, duplicate
sessions, and overlaps under the same lock as the reader/correction workflows.
The entire submitted batch is one transaction: validation failures create no
partial batch. Following a connection interruption, retrying is safe: the server
skips exact existing sessions. A partial collision or overlapping visit requires
review of existing entries, rather than silently rewriting a visit.

Each new session creates a clock-in and clock-out with deterministic IDs,
`manually_edited=true`, and no reader device. Both events receive an `import`
audit record containing actor, reason, semester and source metadata. Later
corrections and deletion tombstones are preserved; reimporting the original CSV
does not restore them. Imported sessions use the normal reporting/calendar rules.
If earlier imported visits appear as voluntary because their dates have no
weekly duties, use [whole-semester application](SCHEDULE_HISTORY.md) to apply
the intended assignments, then refresh Analytics. Do not re-import those visits.

## Link cards and earlier unknown scans

An officer profile can be saved with no NFC UID. In **Officer Roster**, open the
add/link form, scan a card, then type in **Officer name**. Its suggestions contain
existing active profiles without cards; select the imported profile to retain
its history, or enter a new name. First/last name and position remain editable.
For an existing profile without a card, its edit form also accepts a scan.

Outside an admin enrollment window, an unknown card records normal clock-in/out
events in the reader's durable queue. After upload, admins see these in
**Officer Roster > Unlinked card scans**. Choose **Link card** and select or create
the correct profile. Earlier scans are attached with their original times and
event IDs. Paper entries, linked pending scans, and subsequent scans then count
toward the same officer in Log History and Analytics. Unknown cards remain out
of named attendance reports until linked. Pending clock-ins use the same 9 PM
recovery rule as known cards.

The reader must receive one successful context refresh from the updated server
before accepting unknown cards; it caches that capability for offline use. During
an enrollment window, taps only capture the UID for the form. A card can belong
to only one profile, and an already linked card cannot be replaced in this flow.
If paper and pending scans describe an overlapping visit, review the resulting
entries with the existing correction tools; linking does not guess which source
should win.

With the [Live Kiosk upgrade](LIVE_KIOSK.md), today's unknown cards also appear
by NFC UID on the live board and contribute to live on-duty counts. This does
not include them in named Analytics or Log History before card linking.

Keep photos, directories, signatures, and extracted CSVs in the ignored
`development/` folder. Public commits contain only code, schema, instructions,
and fabricated test data. Nothing in the development folder is uploaded by
building the dashboard; only explicitly imported rows reach Supabase.

## Verification

Run `npm test` and `npm run build` in `attendance-dashboard-web`. Tests cover
quoted CSV, name ambiguity, dates/times, source review, duplicates, overlaps,
the preview's import controls, and error handling. The disposable PostgreSQL
harness in `scripts/test_database.py` applies every migration and checks import
authorization, audits, rollback, and retry behavior against a real local server.
It also verifies that simultaneous retries create only one audited event pair.
