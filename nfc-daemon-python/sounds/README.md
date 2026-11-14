# Reader scan sounds

These local PCM WAV files play through the Windows reader PC's audio output.
They work offline and do not require the dashboard to be open.

| File | When it plays |
|---|---|
| `success.wav` | A clock-in or clock-out was saved locally, including pending unlinked-card attendance; also confirms a card captured during enrollment. |
| `unsuccessful.wav` | Clock-out without an open duty, expired/canceled clock-out mode, a blocked unknown card on an outdated server, a UID read failure, or a local processing/recording error. |
| `ignored.wav` | A rapid repeat tap or a card already clocked in. |
| `clock-out-mode.wav` | The special tag opens the window for an officer's clock-out tap. |

The latest cue replaces any previous clip; clips do not queue up or delay scan
processing. Holding an unreadable card on the reader gives one failure cue until
the card is removed. Automatic cutoff recovery and background uploads are silent.
A queued offline scan sounds successful once saved locally; an upload retry
does not replay the sound or turn it into a failure.

To replace a sound, use the same filename and an uncompressed PCM `.wav` file,
then restart the daemon. Volume follows the Windows output device and app mixer.
The ACR122U's automatic card-detection beep is disabled by default, so detecting
a nearby card does not sound like confirmed attendance. The daemon applies this
reader setting before card polling and reapplies it after a USB reconnect.

No configuration edit or extra audio package is required. Optional fields in
the reader's private `config.json` are:

```json
{
  "sounds_enabled": true,
  "sounds_directory": "sounds",
  "reader_buzzer_enabled": false
}
```

Set `sounds_enabled` to `false` to mute all software cues. A relative folder path
is resolved against `nfc-daemon-python`, including when launched by Task Scheduler.
The existing task runs in the signed-in Windows user's session. Missing or
invalid clips and audio-device errors are logged without stopping attendance.
Platforms without Windows audio support run attendance without these cues.

`reader_buzzer_enabled` controls the ACR122U's own detection beep separately from
the PC sounds. Keep it `false` for software-only feedback. Set it to `true` and
restart the daemon to restore the reader beep. Reader commands change the reader
setting, not the contents of NFC cards. No Windows registry edits are made.

To silence a connected ACR122U immediately without recording attendance:

```powershell
.\.venv\Scripts\python.exe reader_buzzer.py --buzzer off
```

If a driver rejects direct reader control, the daemon also tries the documented
command on its first card connection; that first detection may still beep.
Unsupported hardware or rejected commands produce a log warning and do not stop
attendance. The reader's power-on sound, before the daemon connects, is outside
the card-detection setting. A USB power cycle may reset settings, so the daemon
must be running to reapply the preference.

Protocol references: [ACS ACR122U API, section 6.7 and Appendix A](https://downloads.acs.com.hk/drivers/en/API-ACR122U-2.03.pdf),
and [Microsoft's direct reader connection parameters](https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardconnectw).

From `nfc-daemon-python`, preview the files without opening NFC hardware, loading
credentials, or changing attendance:

```powershell
.\.venv\Scripts\python.exe sound_feedback.py --preview all
.\.venv\Scripts\python.exe sound_feedback.py --preview success
```

Include the `sounds` folder when copying the daemon to the office PC. The supplied
clips are versioned with the reader code. Restart the running daemon after updating;
do not launch a second instance beside the existing one.
