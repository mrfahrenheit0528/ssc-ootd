"""Audio/event integration without a reader, cloud, or audible test playback."""
import json
import sqlite3
import tempfile
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import db
import nfc_reader
from config import AppConfig, load_config
from main import _on_event, _process_scan
from sound_feedback import RESULT_SOUNDS, SOUND_FILES, SoundFeedback
from state_machine import Mode, StateMachine, TapResult


class SoundTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name)
        for filename in SOUND_FILES.values():
            with wave.open(str(self.path / filename), 'wb') as sound:
                sound.setnchannels(1)
                sound.setsampwidth(2)
                sound.setframerate(8000)
                sound.writeframes(b'\x00\x00' * 80)
        self.backend = SimpleNamespace(SND_FILENAME=1, SND_ASYNC=2, SND_NODEFAULT=4, PlaySound=Mock())
        self.feedback = SoundFeedback(self.path, backend=self.backend)
        self.conn = db.get_connection(':memory:')
        db.init_db(self.conn)
        self.cfg = AppConfig(clock_out_tag_uid='DEADBEEF', clock_out_window_seconds=60)
        timers = patch('state_machine.threading.Timer', side_effect=lambda *args, **kwargs: Mock())
        timers.start()
        self.addCleanup(timers.stop)
        self.sm = StateMachine(self.cfg, self.conn, lambda uid, result: _on_event(uid, result, self.feedback))
        self.cloud = Mock()
        self.cloud.tap.return_value = False
        self.registry = Mock()
        self.registry.is_enrolled.return_value = True
        self.registry.accepts_unknown_cards.return_value = True
        self.syncer = Mock()

    def tearDown(self):
        self.sm.stop()
        self.feedback.close()
        self.conn.close()
        self.directory.cleanup()

    def scan(self, uid='AAAA1111'):
        return _process_scan(uid, self.cfg, self.conn, self.cloud, self.registry, self.sm, self.syncer, self.feedback)

    def played(self):
        return [Path(call.args[0]).name for call in self.backend.PlaySound.call_args_list if call.args[0] is not None]

    def test_all_event_results_use_async_wav_playback_without_system_fallback(self):
        self.assertEqual(set(RESULT_SOUNDS), set(TapResult))
        for result, kind in RESULT_SOUNDS.items():
            self.feedback.on_result(result)
            self.backend.PlaySound.assert_called_with(str(self.path / SOUND_FILES[kind]), 7)

    def test_recording_is_complete_before_success_is_played_and_ignored_taps_do_not_duplicate_it(self):
        self.backend.PlaySound.side_effect = lambda *_: self.assertEqual(db.get_daily_status(self.conn, 'AAAA1111'), 'ON_DUTY')
        self.assertEqual(self.scan(), TapResult.CLOCKED_IN)
        self.assertEqual(self.scan(), TapResult.IGNORED_DEBOUNCE)
        self.sm._last_tap_times.clear()
        self.assertEqual(self.scan(), TapResult.IGNORED_ALREADY_CLOCKED_IN)
        self.assertEqual(self.played(), ['success.wav', 'ignored.wav', 'ignored.wav'])
        self.assertEqual(len(db.get_unsynced_events(self.conn)), 1)

    def test_clock_out_mode_rejection_success_and_cancel_have_distinct_cues(self):
        self.scan()
        self.sm._last_tap_times.clear()
        self.scan('DEADBEEF')
        self.assertEqual(self.scan('BBBB2222'), TapResult.IGNORED_NOT_ON_DUTY)
        self.assertEqual(self.scan(), TapResult.CLOCKED_OUT)
        self.assertEqual(db.get_daily_status(self.conn, 'AAAA1111'), 'OFF_DUTY')
        self.sm._last_tap_times.clear()
        self.scan('DEADBEEF')
        self.sm._last_tap_times.clear()
        self.scan('DEADBEEF')
        self.assertEqual(self.played(), ['success.wav', 'clock-out-mode.wav', 'unsuccessful.wav', 'success.wav', 'clock-out-mode.wav', 'unsuccessful.wav'])

    def test_clock_out_timeout_plays_once_and_a_cancelled_timer_cannot_expire_a_new_window(self):
        self.scan('DEADBEEF')
        old = self.sm._timer_generation
        self.sm._last_tap_times.clear()
        self.scan('DEADBEEF')  # Cancel the first window.
        self.sm._last_tap_times.clear()
        self.scan('DEADBEEF')  # Open a different window.
        count = len(self.played())
        self.sm._on_clock_out_timeout(old)
        self.assertEqual(len(self.played()), count)
        self.assertEqual(self.sm.get_mode(), Mode.WAITING_FOR_CLOCK_OUT)
        current = self.sm._timer_generation
        self.sm._on_clock_out_timeout(current)
        self.assertEqual(self.played()[-1], 'unsuccessful.wav')
        self.assertEqual(self.sm.get_mode(), Mode.DEFAULT)
        count = len(self.played())
        self.sm._on_clock_out_timeout(current)
        self.assertEqual(len(self.played()), count)

    def test_offline_unknown_cards_that_are_saved_pending_still_sound_successful(self):
        self.cloud.tap.side_effect = ConnectionError('Offline')
        self.registry.refresh.side_effect = ConnectionError('Offline')
        self.registry.is_enrolled.return_value = False
        self.assertEqual(self.scan('UNKNOWN1'), TapResult.CLOCKED_IN)
        self.assertEqual(self.played(), ['success.wav'])
        self.assertEqual(db.get_unsynced_events(self.conn)[0]['card_uid'], 'UNKNOWN1')

    def test_unsupported_unknown_card_fails_without_recording(self):
        self.registry.is_enrolled.return_value = False
        self.registry.accepts_unknown_cards.return_value = False
        self.scan('UNKNOWN1')
        self.assertEqual(self.played(), ['unsuccessful.wav'])
        self.assertEqual(db.get_unsynced_events(self.conn), [])

    def test_enrollment_card_capture_sounds_successful_without_attendance(self):
        self.cloud.tap.return_value = True
        self.scan()
        self.assertEqual(self.played(), ['success.wav'])
        self.assertEqual(db.get_unsynced_events(self.conn), [])
        self.syncer.trigger.assert_not_called()

    def test_recording_failure_sounds_unsuccessful_and_scanning_can_continue(self):
        with patch('db.record_transition', side_effect=sqlite3.OperationalError('Disk unavailable')):
            with self.assertLogs('main', level='ERROR'):
                self.assertIsNone(self.scan())
        self.assertEqual(self.played(), ['unsuccessful.wav'])
        self.assertEqual(db.get_unsynced_events(self.conn), [])
        self.assertEqual(self.scan('BBBB2222'), TapResult.CLOCKED_IN)

    def test_sync_failure_does_not_reclassify_a_locally_successful_scan(self):
        self.syncer.trigger.side_effect = RuntimeError('Sync worker busy')
        with self.assertLogs('main', level='ERROR'):
            self.assertEqual(self.scan(), TapResult.CLOCKED_IN)
        self.assertEqual(self.played(), ['success.wav'])
        self.assertEqual(len(db.get_unsynced_events(self.conn)), 1)

    def test_audio_driver_failure_does_not_interrupt_attendance_or_trigger_default_beeps(self):
        self.backend.PlaySound.side_effect = RuntimeError('No audio output')
        with self.assertLogs('sound_feedback', level='WARNING'):
            self.assertEqual(self.scan(), TapResult.CLOCKED_IN)
        self.assertEqual(db.get_daily_status(self.conn, 'AAAA1111'), 'ON_DUTY')
        self.assertEqual(self.backend.PlaySound.call_count, 1)

    def test_missing_invalid_disabled_and_unsupported_audio_are_safe(self):
        (self.path / 'success.wav').unlink()
        (self.path / 'ignored.wav').write_bytes(b'not a WAV')
        with self.assertLogs('sound_feedback', level='WARNING'):
            incomplete = SoundFeedback(self.path, backend=self.backend)
        self.assertFalse(incomplete.play('success'))
        self.assertFalse(incomplete.play('ignored'))
        self.assertTrue(incomplete.play('clock_out_mode'))
        muted = SoundFeedback(self.path, enabled=False, backend=self.backend)
        self.assertFalse(muted.play('success'))
        with self.assertLogs('sound_feedback', level='WARNING'):
            unavailable = SoundFeedback(self.path, backend=None)
        self.assertFalse(unavailable.play('success'))

    def test_relative_paths_ignore_working_directory_and_shutdown_stops_future_audio(self):
        with patch('sound_feedback.DAEMON_DIR', self.path), patch('sound_feedback.wave.open', side_effect=FileNotFoundError):
            with self.assertLogs('sound_feedback', level='WARNING'):
                relative = SoundFeedback('custom', backend=self.backend)
            self.assertEqual(relative.directory, self.path / 'custom')
        self.feedback.play('success')
        self.feedback.close()
        self.backend.PlaySound.assert_called_with(None, 0)
        self.assertFalse(self.feedback.play('success'))
        self.sm.stop()
        self.sm._on_clock_out_timeout()
        self.backend.PlaySound.assert_called_with(None, 0)

    def test_unreadable_held_card_only_reports_failure_once_until_removal(self):
        failed = Mock()
        reader = nfc_reader.NfcReader(on_read_error=failed)
        reader._running = True
        class NoCard(Exception):
            pass
        connection = Mock()
        connection.connect.side_effect = [None, None, NoCard('Removed'), None, None]
        hardware = Mock()
        hardware.createConnection.return_value = connection
        ticks = []
        def tick(_):
            ticks.append(1)
            if len(ticks) == 5:
                reader.stop()
        with patch.object(nfc_reader, 'NoCardException', NoCard, create=True), patch.object(nfc_reader, 'CardConnectionException', ConnectionError, create=True), \
             patch('nfc_reader._get_uid_from_card', return_value=None), patch('nfc_reader.time.sleep', side_effect=tick):
            self.assertEqual(list(reader._poll_reader(hardware)), [])
        self.assertEqual(failed.call_count, 2)


class SoundConfigTests(unittest.TestCase):
    def test_old_configs_enable_standard_sounds_and_new_configs_can_mute_them(self):
        raw = {'clock_out_tag_uid':'DEADBEEF','supabase_url':'https://ssc-test.supabase.co','supabase_publishable_key':'sb_publishable_test',
               'device_id':'20000000-0000-0000-0000-000000000001','device_token':'example-only-device-token-not-a-real-secret'}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.json'
            path.write_text(json.dumps(raw))
            self.assertTrue(load_config(str(path)).sounds_enabled)
            self.assertEqual(load_config(str(path)).sounds_directory, 'sounds')
            self.assertFalse(load_config(str(path)).reader_buzzer_enabled)
            path.write_text(json.dumps({**raw,'sounds_enabled':False,'sounds_directory':'my-clips'}))
            self.assertFalse(load_config(str(path)).sounds_enabled)
            for patch_value in [{'sounds_enabled':'false'},{'sounds_directory':''},{'reader_buzzer_enabled':'false'}]:
                path.write_text(json.dumps({**raw,**patch_value}))
                with self.assertRaises(ValueError):
                    load_config(str(path))


if __name__ == '__main__':
    unittest.main()
