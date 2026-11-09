# Developer guide

## First-time setup

Use [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for the complete migration sequence.
It covers creating an empty Free project, running the SQL migration, creating
Auth users and roles, configuring local development, registering the reader,
and hosting the website independently of both PCs.

Development prerequisites: Node.js 22.12+ or 24+, Python 3.10+, and an ACR122U
reader for hardware testing. Docker and a local PostgreSQL server are optional
and are not needed for normal operation. The SSC PC needs only the native
reader dependencies, not Node.js or a database server.

On Windows, run `setup-windows.bat` for development or `setup-reader.bat` for
just the reader. These install dependencies; they do not create a cloud project
or overwrite existing private credentials.

Windows reader setup pins `pyscard==2.3.2` and requires its binary wheel instead
of compiling the extension locally. Python 3.12 64-bit is a suitable Windows
development interpreter. The setup script checks the native smart-card imports;
this does not establish that a reader is connected or that its driver works.

## Commands

```powershell
# Dashboard, from the repository root
cd attendance-dashboard-web
npm.cmd ci
npm.cmd run dev
npm.cmd test
npm.cmd run build

# Reader, in a separate terminal from the repository root
.\setup-reader.bat
python scripts/register_reader.py
.\dev-daemon.bat

# Reader tests (no hardware or Supabase account required)
cd nfc-daemon-python
python -m pytest -q
```

The reader tests cover the state machine, scheduler, stable event IDs,
whole-batch upload acknowledgements, offline roster persistence, and atomic
local event/status recording. Export tests exercise CSV formula handling and
actual workbook generation. A build does not verify your cloud credentials.

## PostgreSQL integration tests

`scripts/test_database.py` exercises the actual migration SQL against a fresh
scratch PostgreSQL database. It creates minimal stand-ins for Supabase Auth
and Realtime publication metadata. It checks member/admin permissions,
reader credential boundaries, photo storage, duplicate event replay, batch
rollback, cloud status updates, semester snapshots, and enrollment expiry. It also seeds legacy schedules before the upgrade,
then checks semester revision retention, removed day types, audited corrections,
duplicate-card protection, lease ownership, tombstones, and cutoff recovery.

Install `psycopg[binary]` in a local test virtual environment and create an empty
database named `ssc_migration_test` in a disposable PostgreSQL instance. Set
`SSC_TEST_DATABASE_URL` to it, then run:

```powershell
python scripts/test_database.py
```

The harness refuses any other database name or a database with existing tables.
Use a fresh disposable instance for each bootstrap run. The `anon` and
`authenticated` roles it creates are test fixtures, not production setup.

## Cloud tables and credentials

| Table | Contents |
|---|---|
| `user_roles` | Approved Auth user UUIDs with `admin` or `officer` roles |
| `officers` | Card UID, profile, photo reference, derived status, active flag |
| `officer_photos` | Immutable JPEG/PNG bytes, up to 1 MB per photo |
| `attendance_logs` | UUID, officer, event time/action, source device, correction flags |
| `day_config` | Legacy configuration retained for migration/reference |
| `semester_schedules` | Semester weekly assignments, with immutable revisions |
| `calendar_days` | Day types, notes, nullable assignment overrides, historical revision references |
| `attendance_audit` | Admin identity, reason, and before/after correction records |
| `semesters` | Term dates and archived roster snapshots |
| `system_settings` | Expiring enrollment mode and last enrollment card tap |
| `reader_devices` | Restricted reader identity, token hash, enable/disable flag |

The reader calls `reader_context`, `reader_tap`, and `ingest_attendance` using
its UUID, device token, and the project's publishable key. It has no direct
SQL connection and no service-role key. Cloud writes for an upload batch are
atomic. A replay acknowledges an existing event without overwriting manual
corrections or soft-deleted entries.

The dashboard uses Supabase Auth sessions and row-level security. Changing
UI visibility alone never grants database access. Officer deletion deactivates
the roster entry; attendance and archived photos are retained.

## Backups

Use PostgreSQL client tools compatible with the version running in your
Supabase project. Obtain the connection details from the project's Connect
dialog. For example, set `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, and
`PGSSLMODE=require` locally, then use:

```powershell
pg_dump --format=custom --file=ssc-attendance.dump
```

The client prompts for a password when needed. Store the dump privately, away
from the reader PC, and test restoring it in a separate project. It contains
personal data, photo bytes, role assignments, and device token hashes.
Document Auth/account recovery separately; an export of application tables
alone does not reproduce the full Supabase project or its sign-in accounts.

See [Supabase backup guidance](https://supabase.com/docs/guides/platform/backups).

## Operational notes

- This GitHub repository is public. Commit schema, code, tests, and placeholder
  configuration only. Keep real credentials, officer data, photos, reader tokens,
  and database dumps out of commits; inspect staged files before pushing.
- The dashboard talks to whichever cloud project `.env` selects. There is no
  automatic emulator switch; use a separate project for destructive testing.
- Keep `config.json`, `.env`, `.local/`, local databases, and backups private.
- School dates, report grouping, and the cutoff use `Asia/Manila` and 21:00.
  Local SQLite upgrades in place; preserve its queue when updating a reader.
- Apply every SQL migration in filename order. For an existing cloud project,
  follow [DASHBOARD_UPGRADE.md](DASHBOARD_UPGRADE.md); never rerun the initial SQL.
- Corrections, enrollment leases, and officer writes use checked RPCs. Direct
  browser writes to those tables are revoked. Audit reads are admin-only.
- Reader context merges cloud events with local events whose stable IDs the
  server has not seen, including events uploaded during a snapshot request.
  Older snapshots cannot replace newer state. Queue rows are retained.
- Cloud and local cutoff recovery share `md5(clockInUuid + ':auto-close')` UUIDs.
  This is an idempotency key, not a credential. Recovery runs on reconnect/poll,
  not on an independent cloud timer.
- Windows auto-start uses `nfc-daemon-python/setup_task_scheduler.ps1` and runs
  at user sign-in. It does not record cards while the PC is off or logged out.
- See the final sections of [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for known
  limitations and enhancements to schedule after the cloud migration is live.

## Dashboard UI conventions

Use the shared `.input`, button, card, and calendar interaction styles. Native
selects and their option lists use an opaque dark background and light text,
including Windows/Edge dropdown popups. Keep `color-scheme: dark` on selects.

Reuse the existing `animate-slide-up` page/dialog entrance and `animate-fade-in`
modal backdrop animations, plus the shared button hover/focus/press transitions.
Keep calendar schedule markers in `ScheduleIndicator.jsx`: pushpin means Scheduled
and minus means Unscheduled. Show the shared legend, accessible labels, and title
tooltips; keep full words in forms and reports.

Calendar date-cell borders and background accents identify day types consistently:
Regular is green, No Classes is red, and Optional is blue. Use the shared
`DayTypeLegend` and `.calendar-day[data-day-type]` styles in both calendars.
Attendance fulfillment remains a separate text label; a green Regular cell does
not mean the assigned officers attended.
