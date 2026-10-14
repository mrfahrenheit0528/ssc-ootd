# 🛠️ Developer Setup Guide — SSC NFC Attendance System

> **For development use only.** This guide explains how to run both components of the system locally while the project is still being built.

---

## 📐 System Overview

The project has **two separate components** that run independently:

| Component | Location | Purpose |
|---|---|---|
| **Web Dashboard** | `attendance-dashboard-web/` | React + Vite web app for admin & officer views |
| **NFC Daemon** | `nfc-daemon-python/` | Python script that reads NFC cards and syncs to Firebase |

Both share the same **Firebase (Firestore)** backend as the database.

---

## ✅ Prerequisites

Make sure you have the following installed before starting:

- **Node.js** `v18+` and **npm** (or use [nvm](https://github.com/nvm-sh/nvm))
- **Python** `3.10+`
- A **Firebase project** with Firestore, Authentication, and Storage enabled
- A **PC/SC-compatible NFC reader** (for the daemon — not needed to run the web app alone)

---

## 🔥 Firebase Setup (One-time)

Both components need Firebase credentials. Do this once before running anything.

### 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project (or use an existing one)
3. Enable the following services:
   - **Firestore Database** (Native mode)
   - **Authentication** → Email/Password provider
   - **Storage**

### 2. Get your Web SDK credentials (for the Web Dashboard)

1. In Firebase Console → Project Settings → **Your apps** → Add app → Web
2. Copy the config object values

### 3. Get your Service Account key (for the NFC Daemon)

1. Firebase Console → Project Settings → **Service accounts**
2. Click **Generate new private key**
3. Save the downloaded JSON as `nfc-daemon-python/serviceAccountKey.json`

> ⚠️ **Never commit `serviceAccountKey.json` to Git.** It is already in `.gitignore`.

---

## 🌐 Web Dashboard

### 1. Install dependencies

```bash
cd attendance-dashboard-web
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in your Firebase Web SDK values:

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### 3. Start the development server

```bash
npm run dev
```

The app will be available at **http://localhost:5173**

To also expose it on your local network (e.g. for testing on another device):

```bash
npm run dev -- --host 0.0.0.0
```

### 4. Create the first admin account

1. Open the app in your browser
2. Go to the **Login** page and register with your email
3. In Firebase Console → Firestore, open the `users` collection
4. Find your user document and set `role: "admin"`

### Useful npm scripts

| Command | Description |
|---|---|
| `npm run dev` | Start local dev server with hot reload |
| `npm run build` | Build for production (outputs to `dist/`) |
| `npm run preview` | Preview the production build locally |

---

## 📡 NFC Daemon (Python)

> You only need this running if you have a physical NFC reader connected. The web dashboard works independently without it.

### 1. Create and activate a virtual environment

```bash
cd nfc-daemon-python
python -m venv .venv

# On Linux / macOS:
source .venv/bin/activate

# On Windows:
.venv\Scripts\activate
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

> **Linux users:** You may also need the `pcscd` service and `libpcsclite-dev`:
> ```bash
> sudo apt install pcscd libpcsclite-dev
> sudo systemctl start pcscd
> ```

### 3. Configure the daemon

```bash
cp config.example.json config.json
```

Edit `config.json` with your values:

```json
{
  "clock_out_tag_uid": "REPLACE_WITH_YOUR_CLOCK_OUT_TAG_UID",
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

> **Tip:** To find your clock-out tag's UID, run:
> ```bash
> python scan_uid.py
> ```
> Then tap the NFC card you want to use as the clock-out tag.

### 4. Run the daemon

```bash
python main.py
```

The daemon will:
- Store attendance records locally in `attendance.db` (SQLite)
- Sync records to Firestore every `sync_interval_seconds` seconds
- Auto-close all open sessions at the configured `auto_close_time`

Logs are written to `logs/daemon.log` and also printed to the terminal.

### Running on Windows (startup task)

A PowerShell setup script is included to register the daemon as a scheduled task that starts automatically:

```powershell
powershell -ExecutionPolicy Bypass -File setup_task_scheduler.ps1
```

Or simply double-click `start_daemon.bat` to run it manually.

---

## 🏗️ Project Structure

```
ssc-ootd/
├── attendance-dashboard-web/   # React + Vite web dashboard
│   ├── src/
│   │   ├── pages/              # Dashboard pages (Calendar, Roster, Logs, etc.)
│   │   ├── contexts/           # React contexts (Auth, Semester)
│   │   ├── components/         # Shared UI components
│   │   └── firebase.js         # Firebase SDK initialisation
│   ├── .env                    # ⚠️ Your local env vars (not committed)
│   ├── .env.example            # Template — copy this to .env
│   └── package.json
│
└── nfc-daemon-python/          # Python NFC reader daemon
    ├── main.py                 # Entry point
    ├── config.json             # ⚠️ Your local config (not committed)
    ├── config.example.json     # Template — copy this to config.json
    ├── serviceAccountKey.json  # ⚠️ Firebase Admin key (not committed)
    └── requirements.txt
```

---

## 🔒 Files That Must NOT Be Committed

These files contain secrets and are already in `.gitignore`. Double-check before pushing:

| File | Why |
|---|---|
| `attendance-dashboard-web/.env` | Contains Firebase API keys |
| `nfc-daemon-python/config.json` | Contains project-specific config |
| `nfc-daemon-python/serviceAccountKey.json` | Contains Firebase Admin private key |
| `nfc-daemon-python/attendance.db` | Local SQLite database |

---

## 🧪 Running Without an NFC Reader

The web dashboard is fully functional without the NFC daemon. You can:

- Manually log attendance through the **Live Kiosk** page
- Manage officers, semesters, schedules, and view logs from the admin dashboard
- Test the full UI flow without any hardware

---

## 💡 Tips

- **Hot reload** is enabled in the dev server — any change to source files will instantly update the browser.
- **Firestore emulator** is not currently configured; the app connects to the live Firebase project even in development.
- If you see a **"Firebase is not configured"** error on startup, your `.env` file is missing or incomplete.
- If the NFC daemon shows `Running in OFFLINE mode`, it means `serviceAccountKey.json` is missing — records will still be saved locally in SQLite and synced once the key is added.
