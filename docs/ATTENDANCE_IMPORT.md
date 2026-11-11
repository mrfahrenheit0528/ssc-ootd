# Import paper OOTD attendance

Admins can open **Log History > Import CSV** to review and import handwritten
logbook sessions. The feature creates attendance entries only after the admin
selects **Import sessions** in the preview. Selecting a file does not save it.

## Install the import function once

If both existing migrations already ran, run only the new one:

1. Open [202611120001_attendance_csv_import.sql](../supabase/migrations/202611120001_attendance_csv_import.sql)
   in VS Code and copy the whole file.
2. In your existing Supabase project, open **SQL Editor > New query**.
3. Paste the SQL and click **Run**. Wait for success.
4. Refresh the dashboard and sign in as an admin.

The migration adds one checked import function. It retains existing data and
uses the existing attendance/audit tables. Do not rerun the earlier migrations.
For a new empty project, apply all migrations in filename order.

## Prepare the CSV

Download **Template** in the import dialog. Use one row per complete same-day
visit, with these columns:

| Column | Meaning |
|---|---|
| `date` | Required `YYYY-MM-DD`, within the selected semester |
| `name` | Officer name; optional if a valid `card_uid` is supplied |
| `time_in` | Required `HH:mm` / `HH:mm:ss` in 24-hour time, or `h:mm AM/PM` |
| `time_out` | Required time after time-in, on the same school date |
| `card_uid` | Optional existing officer UID; never invent a UID for a name |
| `signature` | Optional source note, such as `see source photo`; not an electronic signature |
| `source` | Optional photo/page/row reference, at most 200 characters |
| `notes` | Optional transcription/review notes, at most 1000 characters |
| `review_status` | Blank, `ready`, or `confirmed` for reviewed entries; any other value requires review |

Photo transcriptions can also retain `raw_time_in` and `raw_time_out` columns.
These appear beside the editable fields as a reference. `needs_review` rows
must be corrected and marked reviewed, or excluded. Missing clock-outs are not
invented or replaced with a 9 PM estimate. Unmarked handwritten 12-hour times
need AM/PM confirmation. `09:00` in an authored CSV explicitly means 9 AM;
an ambiguous handwritten `9:00` is not sufficient to choose AM automatically.

Names are compared without accents, punctuation, single-letter initials, or
word order. Only a unique full-name match is automatic. Abbreviated, partial,
ambiguous, and unmatched names require the admin to choose an enrolled officer.
Inactive officers remain available for historical imports. The directory PDF
helps transcription but does not enroll officers or supply their card UIDs.

## Review and import

1. Choose the correct semester. Archived semesters are allowed for historical
   attendance; importing does not reactivate the term or change its schedule.
2. Choose a UTF-8 CSV under 1 MB, containing no more than 500 sessions.
3. Wait for the enrolled officer list and existing attendance duplicate check.
4. Review matched names, dates, original written times, and any flagged notes.
   Correct the fields in the preview, or uncheck **Include** for unresolved rows.
   **Select ready rows** excludes all currently invalid and duplicate rows.
5. Confirm each flagged source with **Mark row reviewed** after verifying it.
   Every included row must have complete, valid dates/times and an officer match.
6. Enter an audit reason and click **Import sessions**.
7. Read the imported/duplicate counts. Change Log History's date/semester filter
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
