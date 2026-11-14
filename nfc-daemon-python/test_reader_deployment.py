"""Private packaging, frozen paths and lifecycle checks; never call Supabase."""
import importlib.util
from contextlib import closing
import json
import sqlite3
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock, patch

import runtime_paths
from reader_entry import installation_check
from reader_lifecycle import ReaderAlreadyRunning, ReaderInstance, StopMonitor, request_stop
from sound_feedback import SOUND_FILES


class DeploymentTests(unittest.TestCase):
    def test_instance_lock_prevents_duplicate_readers_and_is_released_after_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            with ReaderInstance(directory):
                with self.assertRaises(ReaderAlreadyRunning):
                    with ReaderInstance(directory):
                        pass
            with ReaderInstance(directory):
                pass

    def test_stop_request_is_local_graceful_and_does_not_leave_a_request_for_a_stopped_app(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertFalse(request_stop(directory))
            self.assertFalse((Path(directory) / '.stop-request').exists())
            reader = Mock()
            with ReaderInstance(directory):
                monitor = StopMonitor(directory, reader)
                monitor.start()
                self.assertTrue(request_stop(directory))
                monitor.join(timeout=3)
                monitor.stop()
                self.assertFalse(monitor.is_alive())
                reader.stop.assert_called_once()
                self.assertFalse((Path(directory) / '.stop-request').exists())

    def test_frozen_runtime_keeps_external_files_beside_executable(self):
        executable = Path(sys.executable).resolve().parent / 'SSCReader.exe'
        with patch.object(sys, 'frozen', True, create=True), patch.object(sys, 'executable', str(executable)):
            self.assertEqual(runtime_paths.app_directory(), executable.parent)
        self.assertEqual(runtime_paths.app_directory(), Path(runtime_paths.__file__).parent)

    def prepare_files(self, path):
        raw = {'clock_out_tag_uid':'DEADBEEF','supabase_url':'https://ssc-test.supabase.co',
               'supabase_publishable_key':'sb_publishable_test','device_id':'20000000-0000-0000-0000-000000000001',
               'device_token':'example-only-private-reader-token-for-tests'}
        (path / 'config.json').write_text(json.dumps(raw), encoding='utf-8')
        (path / 'sounds').mkdir()
        for filename in SOUND_FILES.values():
            with wave.open(str(path / 'sounds' / filename), 'wb') as sound:
                sound.setnchannels(1); sound.setsampwidth(2); sound.setframerate(8000)
                sound.writeframes(b'\0\0' * 80)
        return raw

    def test_diagnostics_never_create_attendance_or_expose_config_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            raw = self.prepare_files(path)
            system = ModuleType('smartcard.System')
            system.readers = Mock(return_value=['ACS ACR122 0'])
            with patch('reader_entry.app_directory', return_value=path), patch.dict(sys.modules, {'smartcard.System':system}):
                report = installation_check()
            self.assertTrue(report['ready'])
            self.assertEqual(report['readers'], ['ACS ACR122 0'])
            self.assertTrue(all(report['sounds'].values()))
            self.assertNotIn(raw['device_token'], json.dumps(report))
            self.assertFalse((path / 'attendance-supabase.db').exists())
            self.assertFalse((path / '.reader.lock').exists())

    def test_private_handoff_keeps_identity_and_takes_consistent_wal_backup_without_changing_source(self):
        build_path = Path(__file__).parents[1] / 'scripts' / 'build_reader_release.py'
        spec = importlib.util.spec_from_file_location('reader_release_builder', build_path)
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source'; source.mkdir()
            target = Path(directory) / 'target'; target.mkdir(); (target / 'sounds').mkdir()
            original = self.prepare_files(source)
            database = source / 'attendance-supabase.db'
            conn = sqlite3.connect(database)
            try:
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('CREATE TABLE sync_queue(event_id TEXT PRIMARY KEY,synced INTEGER)')
                conn.execute("INSERT INTO sync_queue VALUES ('stable-event',0)")
                conn.commit()
                before = (source / 'config.json').read_bytes()
                with patch.object(builder, 'SOURCE', source):
                    builder.copy_private_state(target)
                copied = json.loads((target / 'config.json').read_text(encoding='utf-8'))
                self.assertEqual(copied['device_id'], original['device_id'])
                self.assertEqual(copied['device_token'], original['device_token'])
                self.assertEqual((source / 'config.json').read_bytes(), before)
                self.assertEqual(conn.execute('SELECT * FROM sync_queue').fetchall(), [('stable-event',0)])
                with closing(sqlite3.connect(target / 'attendance-supabase.db')) as snapshot:
                    self.assertEqual(snapshot.execute('SELECT * FROM sync_queue').fetchall(), [('stable-event',0)])
            finally:
                conn.close()


if __name__ == '__main__':
    unittest.main()
