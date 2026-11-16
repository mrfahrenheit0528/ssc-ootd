# Update the office reader - version 2026.11.16.1

This is an update for the existing Windows x64 installation. It includes the
program, dependencies and sounds, with no development attendance database,
reader token, account passwords or replacement private config.

## 1. Prepare Supabase from any computer

If already successful, do not rerun earlier migrations. Run the new file
`supabase/migrations/202611160003_reader_clockout_policy.sql` once in Supabase
SQL Editor. It requires `202611160002_automatic_clockout_policy.sql` first.
The new file is included in this update folder as `RUN IN SUPABASE.sql`.
It preserves the existing policy activation time and all attendance/accounts.

The earlier activation shown was **November 16, 2026 at 10:53 PM Manila time**.
Earlier clock-ins keep their original rule; updating the reader does not
retroactively change old 9 PM automatic entries.

## 2. Transfer and install on the office PC

1. Copy the **new update ZIP** to USB, then to the office PC. Do not reuse the
   November 15 installation package: it contains an older development cache.
2. Sign in with the **same Windows account** used for the installed reader.
3. Ensure the PC is online and its automatic date/time is correct.
4. Extract the entire ZIP to a normal folder. Do not run it inside the ZIP viewer.
5. Double-click **Stop SSC Reader** on the desktop. Keep scans paused during
   the update. Do not reset the attendance cache.
6. Open the extracted `SSCReader` folder and double-click **Update Reader.cmd**.
   It also checks that the old reader has stopped before replacing program files.
7. The updater creates a complete local backup under
   `%LOCALAPPDATA%\SSC Reader Backups\<timestamp>-<id>`, then updates the app.
   It preserves the installed `config.json`, queue/cache database, existing
   custom sound files, office settings and logs. It reuses the existing reader
   identity and refreshes startup at Windows sign-in.
8. The reader starts automatically. Keep it online for at least **60 seconds**
   so it can download/cache the server policy. Pending scans upload normally.
   Never copy the old development database or config over the installed files.

If the updater says no existing installation was found, use the correct Windows
account; this update intentionally cannot register or create a new reader.

## 3. Verify the update

1. Open `%LOCALAPPDATA%\SSC Attendance Reader` through File Explorer's address bar.
2. Run **Check Reader.cmd**, then open `diagnostics.json` in that folder.
3. Confirm `reader_version` is **2026.11.16.1**, `ready` is `true`, and
   `clockout_policy_cached` is `true`. `policy_effective_from` should match the
   existing server activation (it may display UTC with `+00:00`).
4. If policy caching is false, verify the new SQL ran successfully and internet
   is available. Wait another minute or use Stop/Start SSC Reader, then check
   again. Until downloaded once, the program uses the original rule; after
   download it keeps the rule across offline use and reboots.
5. With a designated officer, test one normal clock-in and the clock-out tag
   followed by the officer card. Confirm the real times in Live Kiosk.
6. At a convenient time, test an offline tap/reconnect and Windows sign-in
   startup. Confirm each scan uploads once. Use the normal audited correction
   workflow for any deliberate test attendance that needs removing.

No Python, Node, Git, new NFC driver or device registration is needed.
No database reset or cache reset is part of this update.

## Automatic rule, online and offline

All times use Asia/Manila, and only clock-ins after the existing activation
receive the new rule. Actual clock-outs keep their recorded time.

| Clock-in | Wait until | If no actual clock-out, estimate |
| --- | --- | --- |
| 9 AM | 9 PM | 5 PM |
| 6 PM | 9 PM | 7 PM |
| 8:30 PM | 9:30 PM | 9:30 PM |
| 11:30 PM | 12:30 AM next day | 12:30 AM next day |

Scheduled recovery normally checks every 30 seconds and before each scan. A
powered-off PC cannot collect scans or run its local timer; missed closures
recover on its next start/sync. The online server also recovers due closures
during its existing reader/report refresh paths.

## If the update fails

Do not clear attendance or rerun reset SQL. Keep the reader stopped, note the
error, and retain the backup path printed by the updater. A failed diagnostic
does not register/start the replacement. Backups contain private credentials
and attendance: keep them local. For a rollback, stop the reader and restore
the backed-up program and state together to the original installation folder,
then use Start SSC Reader. Do not upload the backup to GitHub or Cloudflare.
