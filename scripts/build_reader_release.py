"""Build a Windows x64 handoff. Private configuration/SQLite copies stay in .local/."""
import argparse
from contextlib import closing
import json
import os
import platform
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'nfc-daemon-python'


def copy_private_state(destination):
    raw = json.loads((SOURCE / 'config.json').read_text(encoding='utf-8'))
    sys.path.insert(0, str(SOURCE))
    from config import load_config
    cfg = load_config(str(SOURCE / 'config.json'))
    database = Path(cfg.db_path)
    if not database.is_absolute():
        database = SOURCE / database
    if database.exists():
        # SQLite's backup API takes a consistent snapshot even when WAL exists.
        # It neither opens the app nor performs cloud requests/cutoff recovery.
        with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)) as existing:
            with closing(sqlite3.connect(destination / 'attendance-supabase.db')) as backup:
                existing.backup(backup)
    sound_directory = Path(cfg.sounds_directory)
    if not sound_directory.is_absolute():
        sound_directory = SOURCE / sound_directory
    from sound_feedback import SOUND_FILES
    for filename in SOUND_FILES.values():
        shutil.copy2(sound_directory / filename, destination / 'sounds' / filename)
    raw['db_path'] = 'attendance-supabase.db'
    raw['sounds_directory'] = 'sounds'
    (destination / 'config.json').write_text(json.dumps(raw, indent=2) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--include-private', action='store_true', help='Include this reader identity and a read-only queue backup. Output is PRIVATE.')
    parser.add_argument('--dashboard-url', default='', help='Optional final HTTPS dashboard URL for an office desktop shortcut.')
    args = parser.parse_args()
    if sys.platform != 'win32' or platform.architecture()[0] != '64bit':
        raise SystemExit('Build this release with 64-bit Python on Windows.')
    if args.dashboard_url and not args.dashboard_url.startswith('https://'):
        raise SystemExit('The dashboard URL must use HTTPS.')
    label = 'SSCReader-windows-x64-' + datetime.now().strftime('%Y%m%d-%H%M%S')
    output = ROOT / '.local' / 'releases' / label
    output.mkdir(parents=True)
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--windowed',
        '--name', 'SSCReader', '--paths', str(SOURCE), '--distpath', str(output / 'dist'),
        '--workpath', str(output / 'build'), '--specpath', str(output),
        '--collect-all', 'smartcard', '--collect-data', 'tzdata', str(SOURCE / 'reader_entry.py')], check=True)
    bundle = output / 'dist' / 'SSCReader'
    shutil.copytree(SOURCE / 'sounds', bundle / 'sounds')
    for filename in ['config.example.json']:
        shutil.copy2(SOURCE / filename, bundle / filename)
    for filename in ['Install Reader.cmd', 'install-reader.ps1', 'Check Reader.cmd']:
        shutil.copy2(ROOT / 'deployment' / filename, bundle / filename)
    (bundle / 'office-settings.json').write_text(json.dumps({'dashboard_url':args.dashboard_url}, indent=2) + '\n', encoding='utf-8')
    shutil.copy2(ROOT / 'docs' / 'OFFICE_DEPLOYMENT.md', bundle / 'READ ME FIRST.md')
    if args.include_private:
        copy_private_state(bundle)
        report = output / 'build-diagnostics.json'
        completed = subprocess.run([str(bundle / 'SSCReader.exe'), '--check', '--report', str(report)], check=False)
        if completed.returncode or not json.loads(report.read_text(encoding='utf-8')).get('ready'):
            raise SystemExit(f'Packaged diagnostics failed. Check {report}. No archive was created.')
    archive = shutil.make_archive(str(output / label), 'zip', root_dir=output / 'dist', base_dir='SSCReader')
    print('Built:', archive)
    print('PRIVATE: includes reader credentials and local attendance.' if args.include_private else 'Generic build: add the private config before office installation.')
    print('No cloud database calls were made. Stop the old reader and rebuild the final private handoff before moving it.')


if __name__ == '__main__':
    main()
