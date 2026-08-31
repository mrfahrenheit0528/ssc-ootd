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
    service_account_key_path: str = "serviceAccountKey.json"
    firebase_project_id: str = ""
    sync_interval_seconds: int = 10
    debounce_seconds: int = 5
    clock_out_window_seconds: int = 15
    auto_close_time: str = "21:00"
    db_path: str = "attendance.db"
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
        clock_out_tag_uid=raw["clock_out_tag_uid"],
        service_account_key_path=raw.get("service_account_key_path", "serviceAccountKey.json"),
        firebase_project_id=raw.get("firebase_project_id", ""),
        sync_interval_seconds=int(raw.get("sync_interval_seconds", 10)),
        debounce_seconds=int(raw.get("debounce_seconds", 5)),
        clock_out_window_seconds=int(raw.get("clock_out_window_seconds", 15)),
        auto_close_time=raw.get("auto_close_time", "21:00"),
        db_path=raw.get("db_path", "attendance.db"),
        log_level=raw.get("log_level", "INFO"),
    )

    logger.info("Config loaded: clock_out_uid=%s  debounce=%ds  clock_out_window=%ds",
                cfg.clock_out_tag_uid, cfg.debounce_seconds, cfg.clock_out_window_seconds)
    return cfg
