"""Generate private device configuration and SQL without exposing a service key.

Run from the repository root: python scripts/register_reader.py
Existing config.json is updated only for Supabase fields; no Firebase queue is
uploaded because the new cloud queue uses a separate SQLite filename.
"""
import hashlib
import base64
import json
import secrets
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


def main():
    url = input('Supabase project URL: ').strip().rstrip('/')
    key = input('Supabase publishable key: ').strip()
    uid = input('Clock-out tag UID: ').strip().upper()
    if not url.startswith('https://') or not key or not uid:
        raise SystemExit('Project URL, publishable key and clock-out tag UID are required.')
    public = key.startswith('sb_publishable_')
    if not public:
        try:
            payload = key.split('.')[1]
            public = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4))).get('role') == 'anon'
        except (ValueError, IndexError):
            public = False
    if not public:
        raise SystemExit('Use a publishable key, never a secret/service-role key.')
    config_path = ROOT / 'nfc-daemon-python' / 'config.json'
    config = json.loads((ROOT / 'nfc-daemon-python' / 'config.example.json').read_text())
    if config_path.exists():
        existing = json.loads(config_path.read_text())
        if existing.get('device_id') and existing.get('device_token'):
            raise SystemExit('A reader is already registered in config.json. Preserve it; use a separate config file when registering another PC.')
        config.update({k: v for k, v in existing.items() if k in config})
    device_id = str(uuid4())
    token = secrets.token_urlsafe(32)
    config.update(supabase_url=url, supabase_publishable_key=key, clock_out_tag_uid=uid,
                  device_id=device_id, device_token=token, db_path='attendance-supabase.db')
    config.pop('_comment', None)
    config_path.write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')
    private_dir = ROOT / '.local'
    private_dir.mkdir(exist_ok=True)
    digest = hashlib.sha256(token.encode()).hexdigest()
    sql = f"INSERT INTO public.reader_devices(id,name,token_hash) VALUES ('{device_id}','SSC NFC reader','{digest}');\n"
    registration = private_dir / 'register-reader.sql'
    registration.write_text(sql, encoding='utf-8')
    print('Saved private daemon configuration in nfc-daemon-python/config.json.')
    print('Run .local/register-reader.sql in the Supabase SQL Editor to enable this reader.')
    print('Keep config.json private. The registration SQL contains only the token hash.')


if __name__ == '__main__': main()
