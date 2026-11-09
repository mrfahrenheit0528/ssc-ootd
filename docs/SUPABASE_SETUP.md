# Supabase migration: start with an empty project

This guide replaces Firebase with hosted PostgreSQL, Supabase Auth and Realtime.
No Docker or local database server is required to run the system. Existing
Firebase development records are not imported or deleted. The dashboard and
reader code now use Supabase; your cloud project still needs the setup below.

## 1. Create the free cloud project

1. Sign in at <https://supabase.com/dashboard>.
2. Create an organization on the **Free** plan, then a project named
   `ssc-attendance`. Choose a nearby region (APAC / Singapore is a suitable
   starting point for SSC) and save its database password in your password manager.
   On the project creation form:
   - Leave **Connect GitHub** disconnected; it is optional.
   - Keep **Enable Data API** checked; the dashboard and reader use it.
   - Uncheck **Automatically expose new tables**. The migration grants access
     explicitly to the required roles.
   - Check **Enable automatic RLS** as a safeguard for future tables. The
     migration also enables RLS explicitly on every application table.
   - Leave **Advanced configuration** at its defaults.
3. Wait for provisioning. Keep the dashboard open.
4. Under the project's **Connect** dialog or **Settings > API Keys**, find the
   project URL and **publishable key** (`sb_publishable_...`). A legacy `anon`
   key is also supported. The database password and secret/service-role keys
   are not needed by the attendance dashboard or reader.

Free plans have quotas and can pause after insufficient activity over seven
days. Queries include reads, not just new attendance writes. Check pause emails
and resume the project in Supabase if needed; do not assume guaranteed uptime.
See [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
and [current pricing](https://supabase.com/pricing).

## 2. Create the tables and permissions

1. Open **SQL Editor > New query** in the new project.
2. Copy the complete contents of
   [`supabase/migrations/202611090001_initial.sql`](../supabase/migrations/202611090001_initial.sql).
3. Run it once. It creates tables, permissions, reader RPCs, and Realtime
   publication entries inside one transaction. This initial migration is for
   an empty project; do not rerun it after it succeeds.
4. Confirm these tables exist in the Table Editor:
   `user_roles`, `officer_photos`, `officers`, `attendance_logs`, `day_config`,
   `semesters`, `system_settings`, and `reader_devices`.

Every application table has row-level security. Anonymous visitors cannot read
attendance or photos. Approved officers can read; admins can edit. Reader
devices can only call the specific RPCs authorized by their device token.

Photos are compressed by the dashboard and saved as `bytea` in
`officer_photos`, with a 1 MB limit per stored photo. They count against the
database quota, not the separate Supabase Storage allowance. Old photos are
retained because archived semester snapshots may still reference them.

## 3. Create one admin and one officer account

1. In **Authentication > Users**, choose **Add user / Create new user**.
2. Create an admin using an email and a strong password. If available, enable
   **Auto confirm user** so a confirmation email is not needed for this
   manually provisioned account.
3. Copy the new user's UUID and run this in the SQL Editor, replacing the
   placeholder with that UUID:

   ```sql
   insert into public.user_roles(user_id, role)
   values ('REPLACE_WITH_ADMIN_USER_UUID', 'admin');
   ```

4. Create an officer's Auth account and assign its UUID similarly:

   ```sql
   insert into public.user_roles(user_id, role)
   values ('REPLACE_WITH_OFFICER_USER_UUID', 'officer');
   ```

5. Disable public signups in Auth settings if accounts will be provisioned by
   SSC administrators. Signup alone never grants an application role.

An Auth user is an account for signing in. An `officers` row is the NFC roster
entry. Creating one does not automatically create the other. Role changes are
performed through the trusted Supabase dashboard, not through web clients.

## 4. Connect the dashboard on your personal development PC

In PowerShell from the repository root:

```powershell
cd attendance-dashboard-web
npm.cmd ci
# If .env already exists from Firebase, edit it rather than copying over it.
# If it does not exist:
Copy-Item .env.example .env
```

Edit `.env` to contain your project's public connection settings:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

Old `VITE_FIREBASE_*` entries are unused and can be removed. Never put a
Supabase secret/service-role key or database password in a `VITE_*` variable.
Those values are compiled into the browser app.

```powershell
npm.cmd run dev
```

Open <http://localhost:5173>, sign in as the admin, and create a semester. Then
sign in as the officer to verify viewing works and admin controls are absent.
Test an account with no `user_roles` row: it must not gain access. Do this
before entering real personal data.

## 5. Register the reader

From the repository root:

```powershell
.\setup-reader.bat
python scripts/register_reader.py
```

The registration helper asks for the project URL, **publishable** key, and
clock-out tag UID. Use `nfc-daemon-python/scan_uid.py` if the tag UID is unknown.
It creates:

- `nfc-daemon-python/config.json`: private settings and a random device token.
- `.local/register-reader.sql`: the reader's UUID and token hash.

Run the generated `.local/register-reader.sql` in Supabase's SQL Editor. It
enables this reader without giving it a service-role key. To revoke a reader,
set its `reader_devices.enabled` to `false` in the Supabase dashboard.

The helper refuses to replace an existing reader identity. Keep an existing
`config.json` safe; generate a separate identity when adding another reader.
This version is intended for one attendance reader, not multiple simultaneous
readers with independent local duty state.

The new local queue is `attendance-supabase.db`. Old Firebase SQLite files are
left untouched and are not uploaded to the new project. Keep the new queue
file when moving an active reader so pending offline events are preserved.

## 6. Verify an attendance cycle

1. Run just one daemon per reader (stop an existing scheduled instance before
   starting a development instance). Run `dev-daemon.bat`. Its log should confirm the Supabase connection and
   cached roster. Before any officer is enrolled, unknown cards are ignored.
2. Sign in as admin. Open **Officer Roster > Add officer** and tap a card.
   The UID should fill automatically. Enter a name, position, and optional
   photo, then save and close the form.
3. Tap that card again. The kiosk should show a clock-in and the roster should
   show On Duty. Allow the configured debounce interval between repeat taps.
4. Tap the clock-out tag, then the officer card within the 15-second window.
   The kiosk should show a clock-out.
5. Disconnect the reader PC from the internet after the roster has been
   cached. Tap a known card. Reconnect: the event should upload once. Unknown
   cards cannot be enrolled while offline.
6. Restart the daemon offline and verify known cards remain recognized.
7. Reload the roster and archived semester views to check photos persist.
8. Export a CSV and workbook and compare their timestamps and sessions.

During enrollment, attendance is suppressed by an expiring 60-second lease
that the open form renews. If the browser disappears, it expires. Enrollment
requires cloud connectivity; offline taps use the cached roster for normal
attendance.

## 7. Host the website independently of either PC

Use static hosting for the React app, for example Cloudflare Pages. In its Git
integration choose this repository and configure:

| Setting | Value |
|---|---|
| Project root | `attendance-dashboard-web` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `24` |
| Environment variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |

The included `public/_redirects` supports direct links to React routes on hosts
that support that file. Confirm refreshing `/calendar` and `/history` works.
Use the same Supabase project as the reader. In Supabase Auth URL settings,
set the site URL to the published HTTPS address and configure any required
redirect URLs. Sign in and test both roles on the published site.

See [Cloudflare's React guide](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/).
Hosting terms and free quotas are separate from Supabase's database plan.

Only the public site code is hosted there; database permissions continue to
protect attendance. Once hosted, existing uploaded records remain accessible
even when both the SSC PC and your personal PC are off. New NFC events require
the reader PC to be running. Unsynced events become visible after reconnecting.

## 8. Install just the reader on the SSC PC

For the initial migration, use the existing native Python deployment:

1. Install Python 3.10+ and the ACR122U driver as needed. Ensure the Windows
   Smart Card service is available.
2. Copy `nfc-daemon-python/`, `setup-reader.bat`, and `dev-daemon.bat`, preserving
   their relative paths. Transfer `config.json` privately. Do not copy `.venv`;
   recreate it on the destination PC. Preserve `attendance-supabase.db` if
   moving a reader with pending events.
3. Run `setup-reader.bat`, then `dev-daemon.bat`, and verify the full tap cycle.
4. Use `nfc-daemon-python/setup_task_scheduler.ps1` to start the reader on
   Windows sign-in. Node.js, Docker, and PostgreSQL are not required on this PC.

A packaged Windows executable can be a later enhancement. This migration
retains the native Python launchers; it does not yet produce an installer.

## 9. Backups and the next enhancements

Free Supabase projects should have separate exports; free hosting is not a
backup plan. Use a PostgreSQL client version compatible with your cloud server
and Supabase's connection instructions to make protected backups. For example,
with `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGSSLMODE=require` configured
locally, `pg_dump --format=custom --file=ssc-attendance.dump` prompts for a
password when needed. Keep the dump off the reader PC and test restores in a
separate project. It contains personal data, roles, device token hashes and
photo bytes; protect it accordingly. Account/Auth recovery needs its own
documented process in addition to exporting application tables.

The migration preserves the existing local 9 PM scheduler and weekly schedule
model. A cloud cutoff scheduler, missed-cutoff recovery, versioned schedules,
expanded correction auditing, and an executable installer are subsequent
enhancements. Changes to cloud logs update cloud status, but do not yet
reconcile the reader's existing SQLite duty state. Use the reader's normal
clock-in/out workflow when validating this initial migration.

## Tests without a cloud account

```powershell
cd attendance-dashboard-web
npm.cmd test
npm.cmd run build
cd ..\nfc-daemon-python
python -m pytest -q
```

Database integration tests additionally require `psycopg[binary]` and a fresh,
disposable PostgreSQL database named `ssc_migration_test`. Set
`SSC_TEST_DATABASE_URL` and run `python scripts/test_database.py` from the
repository root. The harness creates minimal Supabase Auth/publication stubs
and applies the real migration; it refuses a database with existing tables.
It is not a substitute for verifying Auth and Realtime on the actual project.
