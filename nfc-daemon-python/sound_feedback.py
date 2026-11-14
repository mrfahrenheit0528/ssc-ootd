"""Local Windows WAV feedback. Sound playback never waits for clip duration."""

import logging
import threading
import wave
from pathlib import Path

from state_machine import TapResult
from runtime_paths import app_directory

try:
    import winsound
except ImportError:  # Attendance and hardware-free tests also run off Windows.
    winsound = None

logger = logging.getLogger(__name__)
DAEMON_DIR = app_directory()
SOUND_FILES = {
    'success': 'success.wav',
    'unsuccessful': 'unsuccessful.wav',
    'ignored': 'ignored.wav',
    'clock_out_mode': 'clock-out-mode.wav',
}
RESULT_SOUNDS = {
    TapResult.CLOCKED_IN: 'success',
    TapResult.CLOCKED_OUT: 'success',
    TapResult.IGNORED_DEBOUNCE: 'ignored',
    TapResult.IGNORED_ALREADY_CLOCKED_IN: 'ignored',
    TapResult.IGNORED_NOT_ON_DUTY: 'unsuccessful',
    TapResult.CLOCK_OUT_MODE_ACTIVATED: 'clock_out_mode',
    TapResult.CLOCK_OUT_MODE_TIMEOUT: 'unsuccessful',
    TapResult.UNKNOWN_TAG: 'unsuccessful',
}


class SoundFeedback:
    def __init__(self, directory='sounds', enabled=True, backend=winsound):
        self._backend = backend
        self._enabled = enabled and backend is not None
        self._closed = False
        self._lock = threading.Lock()
        directory = Path(directory)
        self.directory = directory if directory.is_absolute() else DAEMON_DIR / directory
        self._files = {}
        if enabled and backend is None:
            logger.warning('Scan sounds are unavailable on this platform; attendance remains enabled.')
        if not self._enabled:
            return
        for kind, filename in SOUND_FILES.items():
            path = self.directory / filename
            try:
                with wave.open(str(path), 'rb') as sound:
                    if sound.getnframes() == 0 or sound.getcomptype() != 'NONE':
                        raise ValueError('Use a nonempty PCM WAV file')
                self._files[kind] = path
            except (OSError, EOFError, ValueError, wave.Error) as exc:
                logger.warning('Sound %s unavailable (%s): %s', kind, path, exc)

    def on_result(self, result):
        kind = RESULT_SOUNDS.get(result)
        if kind:
            self.play(kind)

    def play(self, kind):
        """Start the latest cue immediately, replacing any previous cue."""
        with self._lock:
            if not self._enabled or self._closed or kind not in self._files:
                return False
            try:
                flags = self._backend.SND_FILENAME | self._backend.SND_ASYNC | self._backend.SND_NODEFAULT
                self._backend.PlaySound(str(self._files[kind]), flags)
                return True
            except Exception as exc:  # Audio must never undo or interrupt a scan.
                logger.warning('Could not play %s sound: %s', kind, exc)
                return False

    def close(self):
        with self._lock:
            if self._enabled and not self._closed:
                try:
                    self._backend.PlaySound(None, 0)
                except Exception as exc:
                    logger.debug('Could not stop scan audio: %s', exc)
            self._closed = True


def preview():
    """Audible, hardware-free check; does not read config or attendance data."""
    import argparse
    parser = argparse.ArgumentParser(description='Preview reader sound files without scanning cards.')
    parser.add_argument('--preview', choices=['all', *SOUND_FILES], required=True)
    parser.add_argument('--sounds-directory', default='sounds')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
    feedback = SoundFeedback(args.sounds_directory)
    kinds = list(SOUND_FILES) if args.preview == 'all' else [args.preview]
    failed = False
    try:
        for kind in kinds:
            path = feedback._files.get(kind)
            if path is None:
                failed = True
                continue
            logger.info('Playing %s', path.name)
            try:
                # This standalone preview waits so all clips can be heard.
                winsound.PlaySound(str(path), winsound.SND_FILENAME | winsound.SND_NODEFAULT)
            except Exception as exc:
                logger.error('Preview failed: %s', exc)
                failed = True
    finally:
        feedback.close()
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(preview())
