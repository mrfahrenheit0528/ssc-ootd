# Council NFC Attendance System

A hybrid local/cloud attendance system using an ACR122U USB NFC reader,
a Python background daemon, SQLite offline buffering, Firebase Firestore,
and a React web dashboard.

---

## Repository Structure

```
ssc-ootd/
├── nfc-daemon-python/          # Python background daemon (Windows service)
├── attendance-dashboard-web/   # React + Vite + TailwindCSS dashboard
├── setup-windows.bat           # One-click dev setup (Windows)
├── dev-web.bat                 # Launch web dashboard (Windows)
├── dev-daemon.bat              # Launch NFC daemon w/ console (Windows)
└── DEV_SETUP.md                # Full developer guide
```

---

## 🚀 Quick Reference — Setting Up Development on a New Device

> Personal checklist for continuing development on another PC (e.g. Linux → Windows).
> For the detailed explanation of each step, see [DEV_SETUP.md](DEV_SETUP.md).

### ✅ 0. Before leaving the old device

- [ ] Commit and push all work: `git add -A && git commit -m "wip" && git push`
- [ ] Copy these **3 gitignored secret files** to a USB drive / secure storage:

| File | Contains |
|---|---|
| `attendance-dashboard-web/.env` | Firebase Web SDK config |
| `nfc-daemon-python/config.json` | Daemon config (clock-out tag UID, project ID, etc.) |
| `nfc-daemon-python/serviceAccountKey.json` | Firebase Admin private key |

- [ ] *(Optional)* Copy `nfc-daemon-python/attendance.db` if it has **unsynced** offline scans.

> [!CAUTION]
> Never commit or upload these files to GitHub, chat apps, or public drives.

### ✅ 1. Install prerequisites on the new device

| Tool | Version | Download | Notes |
|---|---|---|---|
| Git | latest | https://git-scm.com/download/win | Keep default "checkout Windows-style, commit Unix-style" |
| Node.js | v18+ (LTS) | https://nodejs.org | Includes npm |
| Python | 3.10+ | https://www.python.org/downloads/ | ✔ Tick **"Add Python to PATH"** |
| VS Code / IDE | any | https://code.visualstudio.com | Optional |
| ACR122U driver | — | ACS website | Only if Windows doesn't auto-detect the reader |

Verify in a new terminal:

```cmd
git --version
node -v
npm -v
python --version
```

### ✅ 2. Clone the repository

```cmd
git clone https://github.com/mrfahrenheit0528/ssc-ootd.git
cd ssc-ootd
```

### ✅ 3. Restore the secret files

Paste the 3 files from step 0 into the **same relative paths**:

```
ssc-ootd\attendance-dashboard-web\.env
ssc-ootd\nfc-daemon-python\config.json
ssc-ootd\nfc-daemon-python\serviceAccountKey.json
```

> Lost them? Recreate from templates: copy `.env.example` → `.env` and
> `config.example.json` → `config.json`, then fill in values from the
> Firebase Console (Project Settings → Your apps / Service accounts).

### ✅ 4. Run the setup script

**Windows** — double-click or run:

```cmd
setup-windows.bat
```

**Linux / macOS** — manual equivalent:

```bash
cd attendance-dashboard-web && npm install && cd ..
cd nfc-daemon-python
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# Linux only: sudo apt install pcscd libpcsclite-dev && sudo systemctl start pcscd
```

### ✅ 5. Start developing

| Task | Windows | Linux / macOS |
|---|---|---|
| Web dashboard | `dev-web.bat` | `cd attendance-dashboard-web && npm run dev` |
| NFC daemon (console) | `dev-daemon.bat` | `cd nfc-daemon-python && source .venv/bin/activate && python main.py` |
| Find a card's UID | `.venv\Scripts\python scan_uid.py` | `python scan_uid.py` |
| Run tests | `.venv\Scripts\python test_sim.py` | `python test_sim.py && python test_firebase_sync.py` |

Dashboard URL: **http://localhost:5173**

### ✅ 6. Sanity check

- [ ] Dashboard loads and you can log in as admin
- [ ] Daemon log shows `Firebase Admin SDK initialised` (not `OFFLINE mode`)
- [ ] Daemon log shows `Officer cache pre-warmed: N officer(s) loaded`
- [ ] Tapping an enrolled card shows up on the **Live Kiosk** within a few seconds
- [ ] `git status` is clean (no unexpected line-ending diffs)

### 🩹 Common issues on a new device

| Symptom | Fix |
|---|---|
| `'python' is not recognized` | Reinstall Python with **Add to PATH**, or use `py` instead of `python` |
| `npm` blocked in PowerShell | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (or use `cmd`) |
| `No PC/SC readers found` (Windows) | Admin PowerShell: `Start-Service SCardSvr; Set-Service SCardSvr -StartupType Automatic` |
| `No PC/SC readers found` (Linux) | `sudo systemctl start pcscd` |
| `pip install pyscard` fails (Windows) | Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) or use Python 3.10–3.12 |
| Daemon says `Running in OFFLINE mode` | `serviceAccountKey.json` missing or path wrong in `config.json` |
| Dashboard says Firebase not configured | `.env` missing/incomplete — restart `npm run dev` after editing |
| Every file shows as modified in git | `git config core.autocrlf true` (Windows), then `git checkout -- .` |
| Port 5173 already in use | Close the other dev server or run `npm run dev -- --port 5174` |

### 🔁 Daily workflow when switching devices

```bash
git pull            # always first, on the device you're starting on
# ...work...
git add -A
git commit -m "describe change"
git push            # always last, before switching devices
```

---

## Part 1 — Python NFC Daemon Setup

### Prerequisites (Windows PC running the reader)

| Requirement | Notes |
|---|---|
| Python 3.12+ | [python.org](https://python.org) — tick "Add to PATH" |
| PC/SC Smart Card Service | Built into Windows; enable via Services → "Smart Card" |
| ACR122U driver | Install ACS driver from [acs.com.hk](https://www.acs.com.hk/en/drivers/3/acr122u-usb-nfc-reader/) |

### Step 1 — Clone the repository

```bat
git clone https://github.com/YOUR_ORG/ssc-ootd.git
cd ssc-ootd\nfc-daemon-python
```

### Step 2 — Create a virtual environment

```bat
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### Step 3 — Configure the daemon

Copy `config.example.json` to `config.json` (this file is gitignored):

```bat
copy config.example.json config.json
```

Edit `config.json` and fill in:

```json
{
  "clock_out_tag_uid": "AABBCCDD",
  "service_account_key_path": "serviceAccountKey.json",
  "firebase_project_id": "your-firebase-project-id",
  "sync_interval_seconds": 10,
  "debounce_seconds": 5,
  "clock_out_window_seconds": 15,
  "auto_close_time": "21:00",
  "db_path": "attendance.db",
  "log_level": "INFO"
}
```

> **How to find a card's UID**: Run `python scan_uid.py` with the reader
> connected, tap the tag, and the UID will be printed. Use this to identify
> your clock-out tag.

### Step 4 — Set up Firebase (new project)

#### 4a — Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it (e.g. `ssc-attendance`) → Continue
3. Disable Google Analytics (not needed) → **Create project**

#### 4b — Enable Firestore

1. In the Firebase console, click **Firestore Database** (left sidebar)
2. Click **Create database** → choose **Production mode** → select your
   region → **Enable**

#### 4c — Set Firestore Security Rules

In the Firestore console → **Rules** tab, paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Officers collection: read by anyone authenticated, write by admin only
    match /officers/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    // Attendance logs: append-only from authenticated clients
    match /attendance_logs/{logId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
    }
    // System settings: read by anyone authenticated
    match /system_settings/{doc} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
  }
}
```

Click **Publish**.

#### 4d — Generate a Service Account Key

1. In Firebase console → ⚙️ **Project Settings** → **Service accounts** tab
2. Click **Generate new private key** → **Generate key**
3. Save the downloaded `.json` file as `serviceAccountKey.json` inside
   `nfc-daemon-python/`

> ⚠️ **Never commit `serviceAccountKey.json` to git.** It is listed in
> `.gitignore`.

#### 4e — Create the `system_settings/config` document

In Firestore console → **Data** tab:

1. Start collection → Collection ID: `system_settings`
2. Document ID: `config`
3. Add field: `clock_out_tag_uid` (string) → enter your clock-out tag UID

This allows the dashboard to update the clock-out tag without restarting
the daemon.

### Step 5 — Enrol officers

Officers are stored in the `officers` Firestore collection with the card
UID as the document ID. Use the dashboard's **Officer Roster** page to add
officers, or manually create documents with these fields:

| Field | Type | Example |
|---|---|---|
| `first_name` | string | `"Juan"` |
| `last_name` | string | `"dela Cruz"` |
| `position` | string | `"President"` |
| `status` | string | `"OFF_DUTY"` |
| `photo_url` | string | `""` (optional) |

### Step 6 — Run the daemon

```bat
.venv\Scripts\activate
python main.py
```

Logs are written to `logs/daemon.log` and to the console.

### Step 7 — Windows auto-start (Task Scheduler)

See **Part 3 — Windows Deployment** below.

---

## Part 2 — Web Dashboard Setup

See `attendance-dashboard-web/README.md` (generated in Phase 5).

---

## Part 3 — Windows Deployment (Phase 6)

Scripts are in `nfc-daemon-python/`:

| File | Purpose |
|---|---|
| `start_daemon.bat` | Runs the daemon silently via `pythonw.exe` |
| `setup_task_scheduler.ps1` | Registers the bat file to run on login |

Run the PowerShell script **once** as Administrator:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
.\setup_task_scheduler.ps1
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `SCardEstablishContext` error | Ensure the Windows Smart Card service is running |
| `pyscard not installed` | Run `pip install pyscard` in the venv |
| `serviceAccountKey.json not found` | Place the file in `nfc-daemon-python/` |
| Events stuck in SQLite (`synced=0`) | Check `logs/daemon.log` for Firebase errors; verify project ID in `config.json` |
| Wrong UID logged | Run `scan_uid.py` to confirm the raw UID from the reader |

---

## Running Tests (no hardware required)

```bat
# State machine tests
python test_sim.py

# Firebase sync + scheduler tests
python test_firebase_sync.py
```

All 17 tests should pass.

---

## Part 3 — Phase 2: RBAC, Photos & Calendar

### 3.1 Enable Firebase Storage

1. Go to [Firebase Console → Storage](https://console.firebase.google.com/project/ssc-attendance-53245/storage)
2. Click **Get Started** and follow the prompts (choose your region).
3. Firebase Storage is now ready for officer photo uploads.

### 3.2 Create Your Admin Account

Admins can edit officers, manage logs, and configure day types. Visitors (no account) get full read-only access.

**Step 1 — Create the Firebase Auth user:**
1. Go to [Firebase Console → Authentication → Users](https://console.firebase.google.com/project/ssc-attendance-53245/authentication/users)
2. Click **Add User**, enter an email and password.
3. Copy the **User UID** (shown in the users table).

**Step 2 — Grant admin role in Firestore:**
1. Go to [Firebase Console → Firestore](https://console.firebase.google.com/project/ssc-attendance-53245/firestore)
2. Create a collection named `admins`.
3. Create a document with the **User UID** as the Document ID.
4. Add any field, e.g. `role` = `admin` (type: string).

Now log in at `/login` in the dashboard — the Admin nav section will appear.

### 3.3 Firestore Security Rules

Go to [Firebase Console → Firestore → Rules](https://console.firebase.google.com/project/ssc-attendance-53245/firestore/rules) and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAdmin() {
      return request.auth != null &&
             exists(/databases/$(database)/documents/admins/$(request.auth.uid));
    }

    // Officers — public read, admin write
    match /officers/{uid} {
      allow read: if true;
      allow write: if isAdmin();
    }

    // Attendance logs — public read, admin or service account write
    match /attendance_logs/{id} {
      allow read: if true;
      allow write: if isAdmin();
    }

    // Day configuration — public read, admin write
    match /day_config/{docId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    // Semesters — public read, admin write
    match /semesters/{id} {
      allow read: if true;
      allow write: if isAdmin();
    }

    // Live scanner (NFC daemon writes from Admin SDK — bypasses rules)
    match /system_settings/live_scanner {
      allow read, write: if true;
    }

    // Admins collection — admin read only (managed via Firebase Console)
    match /admins/{uid} {
      allow read: if isAdmin();
      allow write: if false;
    }
  }
}
```

### 3.4 Firebase Storage Rules

Go to [Firebase Console → Storage → Rules](https://console.firebase.google.com/project/ssc-attendance-53245/storage/rules) and paste:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Officer photos — public read, authenticated write
    match /officers/{filename} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

### 3.5 Dashboard Features (Phase 2)

| Feature | Who can use it |
|---|---|
| Live Kiosk | Everyone (read-only) |
| Officer Roster (view) | Everyone |
| Officer Roster (edit/enrol/delete) | Admin only |
| NFC auto-fill on enrol | Admin (while daemon is running) |
| Officer photo upload | Admin only |
| Log History (view + export CSV) | Everyone |
| Log History (edit/delete/add) | Admin only |
| Calendar | Everyone (read-only) |
| Day Config | Admin only |
