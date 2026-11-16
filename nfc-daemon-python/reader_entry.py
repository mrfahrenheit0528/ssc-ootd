"""Standalone Windows entry point. Diagnostics never call Supabase or open the queue."""
import argparse
import json
import logging
import platform
import sqlite3
import sys
import wave
from pathlib import Path
from zoneinfo import ZoneInfo

from config import load_config
from runtime_paths import app_directory
from reader_lifecycle import request_stop
from sound_feedback import SOUND_FILES
from reader_version import READER_VERSION
from clockout_policy import validate_policy


def installation_check():
    report = {'reader_version': READER_VERSION, 'frozen': bool(getattr(sys, 'frozen', False)), 'architecture': platform.machine(),
              'config_valid': False, 'timezone_available': False, 'pcsc_available': False,
              'readers': [], 'sounds': {}, 'errors': [], 'clockout_policy_cached': False, 'policy_effective_from': None}
    cfg = None
    try:
        cfg = load_config(str(app_directory() / 'config.json'))
        report['config_valid'] = True
        database = Path(cfg.db_path)
        if not database.is_absolute():
            database = app_directory() / database
        if database.exists():
            # Read-only diagnostics never initialize, recover or upload scans.
            try:
                from contextlib import closing
                with closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro', uri=True)) as conn:
                    row = conn.execute("SELECT value FROM reader_metadata WHERE key='automatic_clockout_policy'").fetchone()
                policy = validate_policy(json.loads(row[0])) if row else None
                report['clockout_policy_cached'] = policy is not None
                report['policy_effective_from'] = policy['effective_from'] if policy else None
            except (sqlite3.Error, ValueError, KeyError):
                report['policy_cache_note'] = 'Connect once after applying the reader policy SQL to cache the current rule.'
    except Exception:
        report['errors'].append('Reader configuration is missing or invalid. Use the private registered config.json.')
    try:
        ZoneInfo('Asia/Manila')
        report['timezone_available'] = True
    except Exception:
        report['errors'].append('Asia/Manila timezone data is missing.')
    try:
        from smartcard.System import readers
        report['readers'] = [str(reader) for reader in readers()]
        report['pcsc_available'] = True
    except Exception:
        report['errors'].append('PC/SC could not load or enumerate readers. Check the Smart Card service and reader driver.')
    directory = Path(cfg.sounds_directory if cfg else 'sounds')
    if not directory.is_absolute():
        directory = app_directory() / directory
    for kind, filename in SOUND_FILES.items():
        try:
            with wave.open(str(directory / filename), 'rb') as sound:
                report['sounds'][kind] = sound.getnframes() > 0 and sound.getcomptype() == 'NONE'
        except Exception:
            report['sounds'][kind] = False
    report['ready'] = report['config_valid'] and report['timezone_available'] and report['pcsc_available']
    if cfg and cfg.sounds_enabled and not all(report['sounds'].values()):
        report['ready'] = False
        report['errors'].append('One or more custom WAV files are missing or invalid.')
    return report


def main():
    parser = argparse.ArgumentParser(description='SSC Attendance Reader')
    parser.add_argument('--version', action='version', version=READER_VERSION)
    parser.add_argument('--check', action='store_true', help='Check local files and PC/SC without changing attendance.')
    parser.add_argument('--report', type=Path, help='Write the local check report here.')
    parser.add_argument('--stop', action='store_true', help='Request a graceful stop of this installation.')
    args = parser.parse_args()
    if args.check:
        report = installation_check()
        text = json.dumps(report, indent=2)
        if args.report:
            args.report.write_text(text + '\n', encoding='utf-8')
        if sys.stdout is not None:
            print(text)
        return 0 if report['ready'] else 1
    if args.stop:
        request_stop(app_directory())
        return 0
    try:
        from main import main as run
        run()
        return 0
    except (Exception, SystemExit):
        log_dir = app_directory() / 'logs'
        log_dir.mkdir(exist_ok=True)
        logging.basicConfig(filename=log_dir / 'startup.log', level=logging.ERROR)
        logging.exception('Reader startup failed.')
        if sys.platform == 'win32':
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, 'SSC Reader could not start. Check config.json and logs in the installation folder.', 'SSC Attendance Reader', 0x10)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
