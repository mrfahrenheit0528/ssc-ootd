# Council NFC Attendance System

A hybrid local/cloud attendance system using an ACR122U USB NFC reader,
a Python background daemon, SQLite offline buffering, Firebase Firestore,
and a React web dashboard.

---

## Repository Structure

```
ssc-ootd/
├── nfc-daemon-python/          # Python background daemon (Windows service)
└── attendance-dashboard-web/   # React + Vite + TailwindCSS dashboard
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
