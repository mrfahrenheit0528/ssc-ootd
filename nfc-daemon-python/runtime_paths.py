"""Writable external files stay beside the app, never in a frozen bundle's internals."""
import sys
from pathlib import Path


def app_directory():
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent
