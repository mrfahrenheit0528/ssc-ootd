# Office deployment and presentation handoff

This deployment keeps the **existing Supabase project, accounts, officers,
semesters, and sample attendance**. There is no database reset, reimport, or new
device registration required when moving the existing reader to the office PC.

## What runs where

| Part | Runs on | Needs the office PC on? |
|---|---|---|
| Reader, local queue, custom sounds | Office Windows 10/11 x64 PC | Yes, for new taps |
| Website | Cloudflare Pages | No |
| Authentication and uploaded records | Existing Supabase project | No |

The installed reader includes Python and its dependencies. The office PC does
not need Python, Node.js, Git, Docker, or PostgreSQL installed. It needs the
ACR122U driver/Windows Smart Card service, a USB port, audio output, and a
signed-in Windows user. Keep it awake during scanning. Internet is needed to
upload new taps and capture enrollment scans; cached attendance works offline.

## 1. Prepare the online dashboard

Use Cloudflare **Pages** with the GitHub repository. Select Pages/Git integration,
not a Workers server deployment. The existing website is a static Vite build.

| Setting | Value |
|---|---|
| GitHub repository | `mrfahrenheit0528/ssc-ootd` |
| Production branch | `main` |
| Root directory | `attendance-dashboard-web` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variable | `NODE_VERSION=24` |
| Environment variable | `VITE_SUPABASE_URL` from the existing dashboard `.env` |
| Environment variable | `VITE_SUPABASE_PUBLISHABLE_KEY` from the same `.env` |

The `.env` file stays local; enter those two existing values in Pages. Use the
same project to retain presentation data. The device token and database password
are not website environment variables. The included `_redirects` handles direct
React routes such as `/analytics` when refreshed.

Deploy, then note the HTTPS `*.pages.dev` address. A custom domain is optional.
Set the existing Supabase project's **Authentication → URL Configuration → Site
URL** to the final HTTPS address, and allow the exact callback URLs needed by any
enabled redirect-based auth flows. Keep approved account roles and signup
restrictions as configured. Test both an admin and an officer account. A public
website address still requires an approved sign-in to view attendance.

Confirm the sample Analytics report, refresh `/calendar` and `/analytics`
directly, and test on another phone/computer. Uploaded history remains available
while the reader PC is off; new offline taps appear online after synchronization.

Official references: [Cloudflare React deployment](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/),
[build settings](https://developers.cloudflare.com/pages/configuration/build-configuration/),
and [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## 2. Build the private office handoff on the development PC

Do not clear or recreate Supabase. Take a private cloud database backup using
[Supabase's backup guidance](https://supabase.com/docs/guides/platform/backups)
before the presentation; exporting attendance CSV alone is not a full backup.
This build process does not create a cloud backup or make cloud database calls.

1. Finish/sync the development reader's pending scans, then stop that daemon.
   Do not run the same reader identity on two PCs at once.
2. From the repository root, build with the daemon's 64-bit Windows environment:

   ```powershell
   .\nfc-daemon-python\.venv\Scripts\python.exe -m pip install -r deployment/requirements-build.txt
   .\nfc-daemon-python\.venv\Scripts\python.exe scripts/build_reader_release.py --include-private --dashboard-url https://YOUR-SITE.pages.dev
   ```

   Omit `--dashboard-url` if hosting is not ready yet. Add the final URL to the
   extracted package's `office-settings.json` before office installation.
3. The ZIP is created in `.local/releases/SSCReader-windows-x64-<timestamp>/`.
   Transfer that ZIP privately on a USB drive. It contains the restricted reader
   credentials and a consistent SQLite backup, including the cached roster and
   any queued scans. It must not be uploaded to the public GitHub repository or
   the website host.

Builds without `--include-private` contain no config/attendance; add a registered
`config.json` before installing them. Do not transfer a development `.venv`.
The bundle is specific to Windows x64, using
[PyInstaller's self-contained distribution](https://pyinstaller.org/en/stable/operating-mode.html).

## 3. One-time office PC installation

1. Plug in the ACR122U. Let Windows detect it; install the appropriate ACS driver
   if needed. Enable accurate automatic date/time and the PC's audio output.
2. Extract the full ZIP to a normal folder, not inside the ZIP viewer.
3. Close any older reader program, then double-click **Install Reader.cmd**
   under the Windows account that staff will use.
4. The installer checks the local runtime and configuration, installs to
   `%LOCALAPPDATA%\SSC Attendance Reader`, creates Start/Stop desktop shortcuts,
   and registers `SSC_NFC_Attendance_Daemon` to start at Windows sign-in. If the
   final dashboard URL is configured, it also creates a dashboard shortcut.
5. It starts the reader in the background. Open the hosted dashboard and sign in.

This setup does not change Supabase or erase local attendance. On a repeat
installation it retains the office `config.json`, queue/cache database, and logs.
Each Windows user has their own application folder: use one designated account
for this office reader. IT may need to allow the app, driver, or scheduled task
under the office's Windows policies.

If local checks fail, open `diagnostics.json` in the installation folder. Checks
do not query Supabase, enroll cards, recover attendance, or modify the queue.
Logs are in `logs/daemon.log`. **Check Reader.cmd** reruns the local diagnostics.
The Start shortcut ignores an extra start while that installation is running;
the Stop shortcut requests a graceful shutdown so pending records stay durable.

## 4. Presentation acceptance test

- [ ] Admin sign-in opens the roster, schedules, and semester management.
- [ ] Officer sign-in can use Live Kiosk, Log History, Calendar, and Analytics,
      while admin management pages remain unavailable.
- [ ] The existing sample semester and mock logbook analytics are visible.
- [ ] Tap once: one saved clock-in and the success sound.
- [ ] Retap: ignored feedback, with no duplicate clock-in.
- [ ] Tap the clock-out tag, then an officer's card: mode cue followed by success.
- [ ] The reader's automatic detection beep stays muted after daemon startup.
- [ ] A new unlinked card is shown by UID in the kiosk and excluded from officer
      analytics until an admin identifies it.
- [ ] Disconnect the internet, scan, reconnect: the same event uploads once.
- [ ] Restart Windows/sign in: background reader starts without opening code.
- [ ] Unplug/replug USB: reader reconnects and reapplies mute.
- [ ] Turn off the reader PC: the website still displays uploaded records.

## Everyday use and updates

Sign in to Windows, plug in the reader, and use the cards. Staff do not need a
terminal or development server. The computer must be powered on and awake; the
current startup mode begins at user sign-in, not before Windows login. The
dashboard can be opened independently on other devices.

For updates, create a new release and run its installer. Never replace the
office database or config with an old development copy. For the first transfer,
rebuild the handoff after stopping the old reader so no later offline records
are stranded. Keep the old private files as a backup until the office test passes.

For the current clock-out policy update, use the generic `--update-only` build
and **Update Reader.cmd** as described in [OFFICE_READER_UPDATE.md](OFFICE_READER_UPDATE.md).
It contains no private configuration or development attendance. The updater
backs up an existing installation, preserves its state/custom sounds, and
requires the same Windows account as the original installation.

Prepared packaging and automated checks do not replace this final test on the
actual office PC. Hosting/account changes still need to be carried out in your
Cloudflare and Supabase accounts; building the package does not publish a site.
