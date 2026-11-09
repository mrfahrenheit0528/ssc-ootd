"""
config.py
---------
Loads the local config.json file and exposes settings as a typed dataclass.
Falls back to safe defaults for optional fields.
"""

import json
import logging
import os
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")


@dataclass
class AppConfig:
    clock_out_tag_uid: str
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    device_id: str = ""
    device_token: str = ""
    attendance_timezone: str = "Asia/Manila"
    sync_interval_seconds: int = 10
    debounce_seconds: int = 5
    clock_out_window_seconds: int = 15
    auto_close_time: str = "21:00"
    db_path: str = "attendance-supabase.db"
    log_level: str = "INFO"


def load_config(path: str = _CONFIG_PATH) -> AppConfig:
    """
    Load config.json from disk and return a validated AppConfig.

    Raises:
        FileNotFoundError: if config.json is missing (user must copy config.example.json).
        KeyError: if a required field is absent.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"config.json not found at '{path}'. "
            "Please copy config.example.json → config.json and fill in your values."
        )

    with open(path, "r", encoding="utf-8") as fh:
        raw = json.load(fh)

    # Strip the _comment key if present
    raw.pop("_comment", None)

    cfg = AppConfig(
        clock_out_tag_uid=raw["clock_out_tag_uid"].upper().strip(),
        supabase_url=raw.get("supabase_url", ""),
        supabase_publishable_key=raw.get("supabase_publishable_key", ""),
        device_id=raw.get("device_id", ""),
        device_token=raw.get("device_token", ""),
        attendance_timezone=raw.get("attendance_timezone", "Asia/Manila"),
        sync_interval_seconds=int(raw.get("sync_interval_seconds", 10)),
        debounce_seconds=int(raw.get("debounce_seconds", 5)),
        clock_out_window_seconds=int(raw.get("clock_out_window_seconds", 15)),
        auto_close_time=raw.get("auto_close_time", "21:00"),
        db_path=raw.get("db_path", "attendance-supabase.db"),
        log_level=raw.get("log_level", "INFO"),
    )

    from uuid import UUID
    import base64
    key = cfg.supabase_publishable_key
    if not key.startswith('sb_publishable_'):
        try:
            payload = key.split('.')[1]
            is_public = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))['role'] == 'anon'
        except (ValueError, KeyError, IndexError):
            is_public = False
        if not is_public:
            raise ValueError('Use a Supabase publishable key or legacy anon key, never a secret/service-role key.')
    if not cfg.supabase_url.startswith('https://'):
        raise ValueError('Set supabase_url to your HTTPS Supabase project URL in config.json.')
    if not cfg.supabase_publishable_key or len(cfg.device_token) < 32:
        raise ValueError('Configure the Supabase publishable key and register this reader; see docs/SUPABASE_SETUP.md.')
    UUID(cfg.device_id)
    if cfg.attendance_timezone != 'Asia/Manila' or cfg.auto_close_time != '21:00':
        raise ValueError('SSC attendance uses Asia/Manila and a 21:00 cutoff; the reader and cloud must agree.')
    if min(cfg.sync_interval_seconds, cfg.debounce_seconds, cfg.clock_out_window_seconds) < 1:
        raise ValueError('Intervals must be positive.')
    logger.info("Config loaded: clock_out_uid=%s  debounce=%ds  clock_out_window=%ds",
                cfg.clock_out_tag_uid, cfg.debounce_seconds, cfg.clock_out_window_seconds)
    return cfg
