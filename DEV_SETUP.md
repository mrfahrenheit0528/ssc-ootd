# Developer Guide — SSC NFC Attendance System

How to set up, run, test and deploy the project. For what the system does,
see the [README](README.md).

## Contents

1. [Components](#1-components)
2. [Prerequisites](#2-prerequisites)
3. [Firebase setup (one time)](#3-firebase-setup-one-time)
4. [Web dashboard](#4-web-dashboard)
5. [NFC daemon](#5-nfc-daemon)
6. [Running tests](#6-running-tests)
7. [Deploying the daemon on Windows](#7-deploying-the-daemon-on-windows)
8. [Moving to another PC](#8-moving-to-another-pc)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Components

| Component | Location | Purpose |
|---|---|---|
| **Web dashboard** | `attendance-dashboard-web/` | React + Vite app for the kiosk, roster, logs, calendar and admin pages |
| **NFC daemon** | `nfc-daemon-python/` | Reads the NFC reader, records taps in SQLite, syncs them to Firestore |

Both talk to the same Firebase project. The dashboard works on its own; the
daemon is only needed when a reader is connected.

### Daemon modules

| File | Role |
|---|---|
| `main.py` | Entry point; wires everything together and runs the tap loop |
| `nfc_reader.py` | Polls the PC/SC reader and yields card UIDs |
| `state_machine.py` | Clock-in / clock-out logic, debounce, 15 s clock-out window |
| `db.py` | SQLite tables `sync_queue` (offline buffer) and `daily_state` |
| `firebase_sync.py` | Background thread that pushes `sync_queue` rows to Firestore |
| `scheduler.py` | Background thread for the daily auto-close (default 21:00) |
| `scan_uid.py` | Helper that prints the UID of any card you tap |

### Firestore collections

| Collection / doc | Written by | Contents |
|---|---|---|
| `officers/{card_uid}` | Dashboard (admin), daemon (`status`) | Name, position, photo, `ON_DUTY` / `OFF_DUTY` |
| `attendance_logs/{id}` | Daemon, dashboard (admin) | `card_uid`, `officer_name`, `type`, `timestamp`, `is_auto_closed` |
| `day_config/{date}`, `day_config/weekly` | Dashboard (admin) | Day type and required officers |
| `semesters/{id}` | Dashboard (admin) | Name, dates, status, `officer_snapshot` |
| `system_settings/live_scanner` | Daemon | Latest tapped UID (auto-fills the enrol form) |
| `system_settings/enrollment_mode` | Dashboard (admin) | `active: true` while the enrol form is open, so the daemon doesn't log attendance |
| `admins/{auth_uid}` | Firebase Console only | Marks a Firebase Auth user as an admin |

---

## 2. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Git | latest | On Windows, keep the default "checkout Windows-style, commit Unix-style" |
| Node.js | 22.12+ or 24+ (LTS) | Includes npm |
| Python | 3.10–3.12 | Tick **Add Python to PATH**. Newer versions may need C++ build tools for `pyscard` |
| ACR122U driver | — | Only if Windows doesn't detect the reader. Get it from [acs.com.hk](https://www.acs.com.hk/en/drivers/3/acr122u-usb-nfc-reader/) |
| Linux only | — | `sudo apt install pcscd libpcsclite-dev && sudo systemctl start pcscd` |

Check your setup:

```bash
git --version
node -v
npm -v
python --version
```

---

## 3. Firebase setup (one time)

Do this once per Firebase project. All links below are in the
[Firebase Console](https://console.firebase.google.com).

### 3.1 Create the project and enable services

1. **Add project**, give it a name, and skip Google Analytics.
2. **Firestore Database** → Create database → **Production mode** → pick a region.
3. **Authentication** → Sign-in method → enable **Email/Password**.
4. **Storage** is optional for officer photos and requires Blaze billing. On Spark, leave it unavailable; publishing the repository does not require upgrading.

### 3.2 Get the credentials

| For | Where | Save as |
|---|---|---|
| Web dashboard | Project settings → **Your apps** → Add app → Web → copy the config values | `attendance-dashboard-web/.env` (see [4.2](#42-configure-environment-variables)) |
| NFC daemon | Project settings → **Service accounts** → **Generate new private key** | `nfc-daemon-python/serviceAccountKey.json` |

> [!CAUTION]
> `serviceAccountKey.json` gives full admin access to your Firebase project.
> Never commit it, paste it into chat, or upload it anywhere public.

### 3.3 Firestore security rules

Rules are the permissions Firebase enforces for dashboard requests. All attendance
records, officer profiles, card UIDs, schedules and semester snapshots require an
admin account. Publishing the source code does not require making this data public.

1. Open **Firestore Database > Rules** and privately back up the existing rules.
2. Copy the entire contents of [`firestore.rules`](firestore.rules) into the editor.
3. Click **Publish**. Saving the repository file alone does not deploy it.

The daemon uses the Admin SDK, which bypasses these rules. Keep its service-account
key private. Admin membership can only be changed through trusted administrative
access, such as the Firebase Console. A signed-in account alone is not an admin.

In **Rules Playground**, verify reads of an existing officer document are denied
for unauthenticated users and signed-in users without an `admins/{uid}` document,
and allowed for your admin UID. Verify writes to `system_settings/live_scanner`
follow the same permissions, and client writes to `admins/{uid}` are denied.
Then check admin login, roster, history and NFC sync in the app. Visitors should
be redirected to login. Rules are not yet covered by automated emulator tests.

### 3.4 Storage security rules

On the Spark plan, Storage may show **Upgrade project** instead of a Rules tab.
Leave it unavailable if photo uploads are not needed. This screen does not prove
that an older bucket never existed; mark its rules as unverified until accessible.

If Storage is enabled on Blaze:

1. Open **Storage > Rules** and privately back up the existing rules.
2. Copy [`storage.rules`](storage.rules) into the editor and click **Publish**.
3. If prompted, grant Storage permission to check Firestore admin membership.
4. Verify only admin accounts can read or write officer photos through the SDK.

Existing token-based photo download URLs can still be used by anyone holding the
URL. If previously shared photos must become private, revoke their download tokens
and update the app's photo delivery before relying on rules alone.

### 3.5 Create an admin account

There is no sign-up page; admins are created in the console.

1. **Authentication → Users → Add user**, enter an email and password.
2. Copy the new user's **User UID**.
3. **Firestore → Data**: create a collection `admins`, add a document whose
   **Document ID is that User UID**, with any field (e.g. `role: "admin"`).

Sign in at `/login` on the dashboard. The **Admin** section appears in the
sidebar.

---

## 4. Web dashboard

### 4.1 Install dependencies

```bash
cd attendance-dashboard-web
npm ci
```

### 4.2 Configure environment variables

```bash
cp .env.example .env
```

Fill in the values from [3.2](#32-get-the-credentials):

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

These values end up in the browser bundle, so they aren't secret. The security
rules are what protect the data. `.env` is still gitignored so each developer
can point at their own project.

### 4.3 Run

```bash
npm run dev                     # http://localhost:5173
npm run dev -- --host 0.0.0.0   # also reachable from other devices on your network
```

| Command | Description |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |

> [!NOTE]
> There is no Firestore emulator set up. The dev server talks to the **live**
> Firebase project, so changes you make while testing are real.

---

## 5. NFC daemon

### 5.1 Create a virtual environment

```bash
cd nfc-daemon-python
python -m venv .venv

# Windows
.venv\Scripts\activate
# Linux / macOS
source .venv/bin/activate

pip install -r requirements.txt
```

### 5.2 Configure

```bash
cp config.example.json config.json
```

| Key | Default | Meaning |
|---|---|---|
| `clock_out_tag_uid` | *(required)* | UID of the tag that opens the clock-out window |
| `service_account_key_path` | `serviceAccountKey.json` | Path to the Firebase Admin key |
| `firebase_project_id` | `""` | Your Firebase project ID |
| `sync_interval_seconds` | `10` | How often pending taps are pushed to Firestore |
| `debounce_seconds` | `5` | Repeat taps of the same card within this time are ignored |
| `clock_out_window_seconds` | `15` | How long the clock-out window stays open |
| `auto_close_time` | `21:00` | Daily time when everyone still on duty is clocked out |
| `db_path` | `attendance.db` | Local SQLite file |
| `log_level` | `INFO` | `DEBUG`, `INFO`, `WARNING`, … |

To find a card's UID, connect the reader, run `python scan_uid.py` and tap
the card. Use this for the clock-out tag. Write the UID in **uppercase**.

### 5.3 Run

```bash
python main.py
```

Logs go to the console and to `logs/daemon.log` (rotated at 5 MB).

A healthy start logs `Firebase Admin SDK initialised` and
`Officer cache pre-warmed: N officer(s) loaded`. If you see
`Running in OFFLINE mode`, the service account key is missing; taps are still
saved to SQLite and sync once the key is added and the daemon restarted.

### 5.4 Enrol officers

Use **Officer Roster → Add officer** on the dashboard while signed in as an
admin. With the daemon running, tapping the officer's card fills in the UID
automatically, and that tap is not counted as attendance.

Only cards enrolled in `officers` are accepted by the daemon. Taps from any
other card are ignored.

### 5.5 Windows launchers

| File | What it does |
|---|---|
| `setup-windows.bat` | Checks Node/Python, runs `npm ci`, creates `.venv`, installs requirements, and checks the secret files are present |
| `dev-web.bat` | Starts the dashboard dev server |
| `dev-daemon.bat` | Starts the daemon with a visible console |
| `nfc-daemon-python\start_daemon.bat` | Starts the daemon silently in the background via `pythonw.exe` |

---

## 6. Running tests

Dashboard CSV security tests and production build (no Firebase connection needed):

```bash
cd attendance-dashboard-web
npm ci
npm test
npm run build
npm audit
```

SheetJS is pinned to its official CDN release because the npm registry package
is outdated. See [SheetJS installation](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/).
Do not replace its dependency URL with the older npm `xlsx` release.
The package overrides select patched gRPC and CSS parser versions while retaining
Firebase and Tailwind compatibility; review them when upgrading those packages.


No reader or Firebase connection needed; hardware and Firestore are mocked.

```bash
cd nfc-daemon-python
python -m pytest -q
# or without pytest:
python test_sim.py
python test_firebase_sync.py
```

All 17 tests should pass. `test_sim.py` covers the state machine;
`test_firebase_sync.py` covers the syncer and the auto-close scheduler.

---

## 7. Deploying the daemon on Windows

To start the daemon automatically on login, run this **once** in an
Administrator PowerShell from `nfc-daemon-python/`:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
.\setup_task_scheduler.ps1
```

This registers `start_daemon.bat` as a scheduled task.

Make sure the Smart Card service starts automatically too:

```powershell
Start-Service SCardSvr
Set-Service -Name SCardSvr -StartupType Automatic
```

---

## 8. Moving to another PC

### Before leaving the old PC

- [ ] Commit and push all work.
- [ ] Copy these gitignored files to secure storage (e.g. a USB drive):

| File | Contains |
|---|---|
| `attendance-dashboard-web/.env` | Firebase web config |
| `nfc-daemon-python/config.json` | Daemon config |
| `nfc-daemon-python/serviceAccountKey.json` | Firebase Admin private key |
| `nfc-daemon-python/attendance.db` | *(Optional)* only if it has unsynced taps |

### On the new PC

1. Install the [prerequisites](#2-prerequisites).
2. Clone the repo:
   ```bash
   git clone https://github.com/mrfahrenheit0528/ssc-ootd.git
   cd ssc-ootd
   ```
3. Put the files above back at the same paths. Lost them? Recreate them from
   `.env.example` and `config.example.json` and the Firebase Console.
4. Run `setup-windows.bat` (Windows), or on Linux / macOS:
   ```bash
   (cd attendance-dashboard-web && npm ci)
   cd nfc-daemon-python && python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```
5. Check that:
   - [ ] the dashboard loads and you can sign in as admin
   - [ ] the daemon log shows `Firebase Admin SDK initialised`
   - [ ] tapping an enrolled card appears on the Live Kiosk within a few seconds
   - [ ] `git status` is clean (no line-ending diffs)

The repo's `.gitattributes` normalises line endings, so switching between
Windows and Linux shouldn't create spurious diffs.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `'python' is not recognized` | Reinstall Python with **Add to PATH**, or use `py` |
| `npm` blocked in PowerShell | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or use `cmd` |
| `No PC/SC readers found` / `SCardEstablishContext` error (Windows) | Start the Smart Card service (see [section 7](#7-deploying-the-daemon-on-windows)) |
| `No PC/SC readers found` (Linux) | `sudo systemctl start pcscd` |
| `pip install pyscard` fails | Use Python 3.10–3.12, or install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) |
| Daemon says `Running in OFFLINE mode` | `serviceAccountKey.json` missing, or wrong path in `config.json` |
| Taps stay unsynced (`synced = 0` in SQLite) | Check `logs/daemon.log` for Firebase errors; check `firebase_project_id` |
| Card taps are ignored as "not enrolled" | Enrol the card in Officer Roster; check the daemon log for `OfficerRegistry updated` |
| Clock-out tag isn't recognised | Write `clock_out_tag_uid` in uppercase; confirm it with `scan_uid.py` |
| Enrol tap is logged as attendance | `system_settings` rule missing; re-publish the rules in [3.3](#33-firestore-security-rules) |
| Dashboard says Firebase is not configured | `.env` missing or incomplete; restart `npm run dev` after editing |
| Every file shows as modified in git | Review and save your edits first; set `git config core.autocrlf true` (Windows) for future checkouts |
| Port 5173 already in use | Stop the other dev server, or `npm run dev -- --port 5174` |
