# Set up SSC Attendance with Supabase

Already running the system? Start with [the dashboard upgrade guide](DASHBOARD_UPGRADE.md) to apply the new scheduling migration.

Follow this guide in order. You can skip any step you have already completed.
If you already created your accounts and are looking for **public signups**, go
straight to [Step 3A](#3a-turn-off-public-signups).

You will use two places:

| Place | What you do there |
|---|---|
| **Supabase dashboard**, in your browser | Create the database and sign-in accounts |
| **This repository**, open in VS Code | Edit local settings and run the attendance app |

For now, use your **personal development PC**. Installing the reader on the SSC
PC comes later. Docker is not needed. Existing Firebase development data will
not be copied or deleted.

## Before you start

Keep these terms handy:

| Term | Meaning in this guide |
|---|---|
| Project | Your `ssc-attendance` workspace in Supabase |
| SQL Editor | A page inside Supabase where you paste and run database instructions |
| User ID / UUID | A long identifier belonging to one sign-in account; it is not an email or password |
| Publishable key | The project connection key beginning with `sb_publishable_` |
| `.env` | A local settings file used by the web dashboard |
| Repository root | The main `ssc-ootd` folder, containing `README.md` and `setup-reader.bat` |

There are **two different kinds of password**. The database password belongs to
PostgreSQL. The admin/officer passwords are the ones people use to sign in to
the attendance website. They are separate.

This GitHub repository is public. Keep real passwords, device tokens, photos,
attendance exports, and local configuration out of commits. The supplied SQL
migration contains the database structure and permissions, not your credentials.

## 1. Create your Supabase project

**Where: Supabase dashboard in your browser.**

1. Open <https://supabase.com/dashboard> and sign in.
2. Create an organization on the **Free** plan if you do not already have one.
3. Click **New project** and fill in the form:

   | Setting | What to choose |
   |---|---|
   | Project name | `ssc-attendance` |
   | Database password | Generate a strong password and save it privately |
   | Region | APAC / Singapore is a suitable starting point for SSC |
   | Connect GitHub | Skip for now |
   | Enable Data API | Checked |
   | Automatically expose new tables | Unchecked |
   | Enable automatic RLS | Checked |
   | Advanced configuration | Leave the defaults |

4. Click **Create new project**.
5. Wait until the project dashboard is ready.

**Checkpoint:** You can open the `ssc-attendance` project and see its sidebar.

## 2. Create the database tables

**Where: VS Code first, then Supabase.**

Skip this step if the migration already ran successfully. Run it only once in
an empty project.

1. In VS Code, open
   [`supabase/migrations/202611090001_initial.sql`](../supabase/migrations/202611090001_initial.sql).
2. Click inside the file. Press **Ctrl+A**, then **Ctrl+C** to copy all its SQL.
3. In your Supabase project, click **SQL Editor** in the left sidebar.
4. Create a **New query**. Paste the SQL into that query with **Ctrl+V**.
5. Click **Run** and wait for it to finish.
6. Open **Table Editor** in the sidebar and select the `public` schema if asked.
7. Check that you can see these eight tables:

   ```text
   user_roles
   officer_photos
   officers
   attendance_logs
   day_config
   semesters
   system_settings
   reader_devices
   ```

**Checkpoint:** The query finishes without errors and all eight tables exist.
It is normal for the tables to be empty.

The SQL also sets up access permissions. Approved officers can view records;
admins can manage them. Photos are stored directly in PostgreSQL, in
`officer_photos`. No separate Storage bucket is needed for this version.

If you see an error such as **already exists**, do not delete tables or keep
rerunning the file. Check whether this step already succeeded.

## 2A. Add semester schedules and dashboard fixes

After Step 2 succeeds, run the additional migration once:

1. Open [202611100001_dashboard_refinement.sql](../supabase/migrations/202611100001_dashboard_refinement.sql) in VS Code.
2. Copy the whole file, open a **New query** in Supabase **SQL Editor**, paste,
   then click **Run**.
3. Check that `semester_schedules`, `calendar_days`, and `attendance_audit`
   appear in Table Editor, alongside the original eight tables.

For an existing working project, follow [DASHBOARD_UPGRADE.md](DASHBOARD_UPGRADE.md)
instead of repeating the initial setup. Both migrations are required by the
current dashboard and reader.

## 3. Set up website sign-in accounts

### 3A. Turn off public signups

**Where: Supabase dashboard, inside your `ssc-attendance` project.**

?Public signups? means people can create their own accounts. Supabase labels
this setting **Allow new users to sign up**.

1. Click **Authentication** in the left sidebar.
2. In the Authentication menu, find the **Configuration** section.
3. Click **Sign In / Providers**. Some dashboard versions shorten this to
   **Providers**.
4. Find the switch labeled **Allow new users to sign up** in the general
   sign-up settings on that page.
5. Turn that switch **off**.
6. Click **Save changes** or **Save**, if a save button appears.

You can also open the [Sign In / Providers page](https://supabase.com/dashboard/project/_/auth/providers)
and select your project if Supabase asks you to choose one.

Keep **Email** sign-in enabled. Turning off self-registration does not stop
existing users from signing in, and you can still create accounts manually
through **Authentication > Users**.

**Checkpoint:** The new-user signup switch is off, and Email sign-in remains
available.

Source: [Supabase authentication settings](https://supabase.com/docs/guides/auth/general-configuration).

### 3B. Create your admin sign-in account

**Where: Supabase dashboard.**

If you already created this account, open its user details and continue from
step 7 below.

1. Click **Authentication** in the sidebar.
2. Click **Users**.
3. Click **Add user**, then choose **Create new user**.
4. Enter the email address and password you want to use for the attendance app.
5. Enable **Auto Confirm User**, if shown. This confirms this manually created
   account without requiring a confirmation email.
6. Click **Create user**.
7. Open the new user's details and copy its **User ID** or **UID**. It looks
   like a long string of letters, numbers, and hyphens.
8. Open **SQL Editor > New query**.
9. Paste this SQL. Replace only `PASTE_ADMIN_USER_ID_HERE` with the ID you
   copied. Keep the single quotation marks around it.

   ```sql
   insert into public.user_roles (user_id, role)
   values ('PASTE_ADMIN_USER_ID_HERE', 'admin')
   on conflict (user_id) do update set role = excluded.role;
   ```

10. Click **Run**.
11. Open **Table Editor > user_roles**. Check that the account's ID has the
    role `admin`.

**Checkpoint:** The account appears in **Authentication > Users**, and its ID
appears in **user_roles** with `admin` beside it.

Creating an account alone does not grant access to attendance data. The
`user_roles` entry is the approval that gives it access.

### 3C. Create an officer sign-in account

1. Return to **Authentication > Users**.
2. Create another user with a different email address and password. Enable
   **Auto Confirm User** if shown.
3. Copy this officer account's User ID. Use the officer's ID, not your admin ID.
4. Open a new SQL query and run the following after replacing the placeholder:

   ```sql
   insert into public.user_roles (user_id, role)
   values ('PASTE_OFFICER_USER_ID_HERE', 'officer')
   on conflict (user_id) do update set role = excluded.role;
   ```

5. Check **Table Editor > user_roles** again.

**Checkpoint:** You have two different accounts: one `admin` and one `officer`.

A **sign-in account** gives someone access to the website. An **NFC roster
entry** connects a physical card to an officer. We will create the roster entry
in Step 6. One does not automatically create the other.

## 4. Connect and open the web dashboard

### 4A. Find your project URL and publishable key

**Where: Supabase dashboard.**

1. Open your project and click **Connect** near the top of the dashboard.
2. Select the application/framework connection instructions, such as React,
   if the dialog asks. Copy the **Project URL** and **Publishable key**.
3. For the key, you can also use **Project Settings > API Keys**. Choose the
   publishable key beginning with `sb_publishable_`.

Use the project URL, which looks like `https://YOUR_PROJECT_REF.supabase.co`.
Do not use a PostgreSQL connection string beginning with `postgresql://`.

Source: [Where to find Supabase keys](https://supabase.com/docs/guides/getting-started/api-keys#find-your-keys).

### 4B. Open the terminal in the correct folder

**Where: VS Code on your personal PC.**

1. Open the `ssc-ootd` repository in VS Code.
2. Choose **Terminal > New Terminal** from the top menu. Use PowerShell for the
   commands below.
3. Run this to make sure you start in the repository root:

   ```powershell
   Set-Location 'F:\GitHub Repo\ssc-ootd'
   ```

   This path matches your current development PC. Use the actual repository
   path if you later move the project to another folder or computer.

4. Install the dashboard dependencies:

   ```powershell
   cd attendance-dashboard-web
   npm.cmd ci
   ```

5. Wait for the installation to finish before entering the next command.

**Checkpoint:** The terminal prompt ends in `attendance-dashboard-web`, and
`npm.cmd ci` finishes without an error. Node.js 22.12+ or 24+ must be installed.

### 4C. Edit the local settings file

1. In that same terminal, run:

   ```powershell
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }
   ```

   This creates `.env` only if it does not already exist.

2. In VS Code's file explorer, open **attendance-dashboard-web > .env**.
3. Set these two lines using the values copied from Supabase:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
   ```

4. Replace the example values to the right of `=` with your actual values.
   Keep the variable names exactly as written. Paste only the values, not
   surrounding backticks or the `dotenv` label.
5. Save the file with **Ctrl+S**. Old `VITE_FIREBASE_*` lines can be removed.

The publishable key is intended for browser applications. A key starting with
`sb_secret_`, a `service_role` key, and the database password do not belong in
this file. `.env` is excluded from Git.

### 4D. Run and check the website

1. In the same terminal, run:

   ```powershell
   npm.cmd run dev
   ```

2. Leave this terminal running. It is serving the development website.
3. Open the local address printed in the terminal, usually
   <http://localhost:5173>.
4. Sign in with your **admin account's email and password** from Step 3B.
5. Open **Semesters** and create your first semester.
6. Sign out and sign in with the officer account from Step 3C.

**Checkpoint:** The admin can open the management pages. The officer can view
attendance but does not see the admin management controls.

If the website says your account needs a role, go back to Step 3 and check the
User ID in `user_roles`. If the setup screen still appears after editing `.env`,
stop the terminal with **Ctrl+C**, then run `npm.cmd run dev` again.

You can pause here if you only want to test the website today. The next steps
need the NFC reader hardware.

## 5. Connect the NFC reader to Supabase

### 5A. Install the reader dependencies

**Where: A second VS Code terminal, on the PC with the reader attached.**

Leave the dashboard terminal running. Open **Terminal > New Terminal** and run:

```powershell
Set-Location 'F:\GitHub Repo\ssc-ootd'
.\setup-reader.bat
```

Wait for **Reader dependencies installed**. Python 3.10+ must be installed and
available in your terminal.

For Windows, **Python 3.12 64-bit** is a suitable choice. The setup script
installs a prebuilt `pyscard` package, so SWIG and C++ build tools are not
needed. It also checks that the smart-card module can load before reporting
success. The reader driver and USB connection are checked when you scan a card.

If an older checkout fails with **`swig.exe` failed** while installing
`pyscard==2.0.7`, update to the latest repository files and run
`.\setup-reader.bat` again. The repository now uses `pyscard==2.3.2`, which has
a prebuilt package for Python 3.12 on 64-bit Windows. You do not need to change
your Supabase settings or reinstall the database.

If pip reports **No matching distribution found**, check the interpreter used
by the reader's existing virtual environment:

```powershell
.\nfc-daemon-python\.venv\Scripts\python.exe --version
```

Installing another Python version does not change an existing virtual
environment. If the version is unsupported, stop the reader, rename its `.venv`
folder to the unused name `venv.bak` (which Git ignores). From the repository
root, run `py -3.12 -m venv nfc-daemon-python/.venv` to recreate it with Python
3.12, then rerun setup. The `py -3.12` command requires Python 3.12 to be
installed with the Windows Python launcher. Keep `config.json` and `attendance-supabase.db`; those
contain the reader settings and offline records.

### 5B. Find the clock-out tag's ID

The clock-out tag is the special card/tag that authorizes a clock-out. Choose
one tag for this purpose; it should be separate from officer attendance cards.

1. Plug in the NFC reader.
2. From the repository root in the second terminal, run:

   ```powershell
   .\nfc-daemon-python\.venv\Scripts\python.exe .\nfc-daemon-python\scan_uid.py
   ```

3. Tap the clock-out tag and copy the UID printed in the terminal.
4. Press **Ctrl+C** to stop the scanner before continuing.

**Checkpoint:** You have the clock-out UID, an uppercase sequence such as
`A1B2C3D4`. That is just an example; use your tag's actual UID.

### 5C. Generate this reader's settings

1. In that second terminal, from the repository root, run:

   ```powershell
   python scripts/register_reader.py
   ```

2. Answer each prompt, pressing **Enter** after each value:

   | Prompt | Paste this |
   |---|---|
   | Supabase project URL | The same project URL used in `.env` |
   | Supabase publishable key | The same publishable key used in `.env` |
   | Clock-out tag UID | The actual UID from Step 5B |

3. Wait for the script to confirm it saved the settings.
4. In VS Code, open **.local > register-reader.sql**. The script created this
   folder and file; you do not need to write the SQL yourself.
5. Copy all the SQL in that file.
6. In Supabase, open **SQL Editor > New query**, paste it, and click **Run**.
7. Open **Table Editor > reader_devices** and confirm that the reader appears
   with `enabled` set to `true`.

**Checkpoint:** The device row exists in Supabase, and your local
`nfc-daemon-python/config.json` has been created or updated.

Keep `config.json` private: it contains the reader's device token. The generated
SQL contains a token hash, not the token. Both files are excluded from Git.
If the script says a reader is already registered, keep the existing identity;
do not delete its settings just to rerun this step.

The new offline attendance file is `attendance-supabase.db`. Old Firebase
SQLite files are left untouched. Keep the new file when moving an active
reader so unsent attendance is preserved. This version supports one attendance
reader with one local duty-state database.

## 6. Test an officer card from start to finish

**Where: The second terminal, the attendance website, and the NFC reader.**

1. Run `dev-daemon.bat` from the repository root in the second terminal:

   ```powershell
   .\dev-daemon.bat
   ```

2. Leave that terminal open. Look for a log message confirming the Supabase
   connection and a message saying it is ready for NFC cards.
3. Sign in to the attendance website as admin.
4. Open **Officer Roster > Add officer**.
5. Tap the officer's card. Its UID should fill in automatically.
6. Enter the officer's name, position, and an optional photo. Save and close
   the form.
7. Tap the officer's card again. Open **Live Kiosk** and check for a clock-in.
8. Wait at least **5 seconds** before repeating a tap with the same card.
9. Tap the special clock-out tag, then tap the officer's card within
   **15 seconds**. Check that a clock-out appears.

**Checkpoint:** You can see a complete clock-in and clock-out session.

Run only one reader program at a time. If you previously set up an automatic
Windows task for the reader, stop that instance before starting a development
instance.

After the basic cycle works, check these items:

- [ ] Reload the roster and confirm the photo still displays.
- [ ] Disconnect this PC from the internet and tap a previously enrolled card.
- [ ] Reconnect and confirm the event uploads once.
- [ ] Restart the reader offline and confirm known cards are still recognized.
- [ ] Export a CSV and an Excel workbook and inspect the attendance times.

New-card enrollment needs internet access. Normal offline attendance uses the
roster previously saved on the reader PC. While the enrollment form is open,
its card scans are used for enrollment instead of attendance.

## 7. Put the website online

The local development website depends on your personal PC being on. This step
hosts it separately so admins and officers can access it when both PCs are off.

**Where: A static website host, such as Cloudflare Pages.**

1. Sign in to Cloudflare and open **Workers & Pages**.
2. Choose **Create application > Pages > Import an existing Git repository**.
3. Connect your GitHub account if asked, and select the `ssc-ootd` repository.
4. Use these build settings:

   | Setting | Value |
   |---|---|
   | Production branch | `main` |
   | Root directory | `attendance-dashboard-web` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Node version | Set environment variable `NODE_VERSION` to `24` |

5. Add the two environment variables from your local `.env` using the same
   names and values: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
   The host will not receive your local `.env` through GitHub.
6. Start the deployment and wait for a successful build.
7. Copy the public HTTPS website address the host gives you.
8. In Supabase, open **Authentication > URL Configuration**.
9. Set **Site URL** to that public address and save. Add redirect URLs there
   if you later enable sign-in flows that require them.
10. Open the public website and test both admin and officer sign-in.
11. Open `/calendar` and refresh the page to check that direct links work.
12. Turn off the reader PC and confirm you can still view uploaded records
    from another device using the public website address.

**Checkpoint:** The public website works independently of your personal PC and
the SSC PC. New physical taps still require the reader PC to be running.

See [Cloudflare's React deployment guide](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/).
The included `public/_redirects` supports React routes on compatible hosts.
Website hosting quotas are separate from Supabase's database quotas.

## 8. Move the reader to the SSC PC

Do this after the website and test reader work on your personal PC.

1. Install Python 3.10+ on the SSC PC. During installation, enable the option
   that adds Python to PATH.
2. Install the ACR122U driver if Windows does not recognize the reader. The
   Windows Smart Card service must be available.
3. Copy this folder structure, preserving the relative locations:

   ```text
   ssc-ootd/
     setup-reader.bat
     dev-daemon.bat
     nfc-daemon-python/
       ...the Python source and launcher files...
       config.json
       attendance-supabase.db   (preserve if it has pending events)
   ```

4. Transfer `config.json` privately. Do not copy the `.venv` folder; the next
   step recreates it for the SSC PC. Do not keep the original reader instance
   running on your personal PC after moving its identity.
5. Double-click **setup-reader.bat** and wait for it to finish.
6. Double-click **dev-daemon.bat** and repeat the card test from Step 6.
7. Once it works, open PowerShell in `nfc-daemon-python` and run:

   ```powershell
   .\setup_task_scheduler.ps1
   ```

8. Follow its prompt to start the reader automatically at Windows sign-in.
   If Windows blocks the script, use the instructions at the top of that
   `.ps1` file to configure the execution policy.

**Checkpoint:** After signing in to Windows on the SSC PC, the reader runs
and uploads attendance. The PC needs no Node.js, Docker, or PostgreSQL server.

This version uses native Python launchers. A standalone Windows installer can
be added after the migration is working.

## 9. Understand free hosting and backups

Supabase Free can pause projects after insufficient activity over seven days.
Reads count as activity, not just new writes. Watch the project owner's email
for pause notices. To resume a paused project, open it in the Supabase dashboard
and select **Resume project**.

Compressed photos count against PostgreSQL's database storage allowance. Each
stored photo is limited to 1 MB. Old photos may still be referenced by archived
semesters, so they are retained.

Database backups must be kept separately. A CSV attendance export is useful,
but it is not a complete database backup. Before relying on the system for
real records, arrange regular protected database exports and test restoring
them. See the backup notes in [DEV_SETUP.md](DEV_SETUP.md#backups). Account
recovery also needs a documented process.

Official references: [free-project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
and [current pricing](https://supabase.com/pricing).

## If something does not work

| What you see | What to check |
|---|---|
| Cannot find ?public signups? | Step 3A: Authentication > Configuration > Sign In / Providers; the switch is named Allow new users to sign up |
| SQL says ?already exists? | Step 2 may already be complete; check Table Editor before rerunning anything |
| SQL says ?invalid input syntax for type uuid? | Replace the entire User ID placeholder with the copied account ID, keeping the quotes |
| Website says the account needs an SSC role | The User ID in `user_roles` must match the account in Authentication > Users |
| Website says the email is not confirmed | Check that the manually created account is confirmed in Authentication > Users |
| Website shows a setup message | Check both `.env` values, save the file, and restart `npm.cmd run dev` |
| `npm` or `python` is not recognized | Install the required tool, then open a new terminal |
| Setup fails with `swig.exe` while installing `pyscard==2.0.7` | Update the repository and rerun `setup-reader.bat`; see Step 5A |
| No reader is found | Check the USB connection, reader driver, and Windows Smart Card service |
| Reader warns `GET UID APDU returned SW1=63 SW2=00` | That UID read failed. Remove and present one card steadily until `Tag detected` appears; check for the clock-in/out confirmation. Occasional warnings followed by success can be transient. Persistent failures need a reader/card/USB check; the code alone does not identify the cause. |
| Card UID does not fill in | Keep the Add officer form open, ensure the reader is online, and verify device registration from Step 5C |
| Events stay only on the reader PC | Check internet access, project pause status, and the reader's `enabled` field |

## What comes after the migration

Semester schedules, day calendars, audited corrections, and missed-cutoff
recovery are included in the dashboard upgrade. See
[DASHBOARD_UPGRADE.md](DASHBOARD_UPGRADE.md) for the workflow and recovery limits.
Independent backups, account recovery, hosting checks, and a live reader/browser
smoke test are still needed before relying on the system for real records.

For developer commands and automated tests, use [DEV_SETUP.md](DEV_SETUP.md).
