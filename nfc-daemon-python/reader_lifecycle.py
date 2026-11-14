"""One reader process per installation and a local graceful stop request."""
import os
import threading
from pathlib import Path


class ReaderAlreadyRunning(RuntimeError):
    pass


class ReaderInstance:
    def __init__(self, directory):
        self.path = Path(directory) / '.reader.lock'
        self.file = None

    def __enter__(self):
        self.file = self.path.open('a+b')
        if self.file.tell() == 0:
            self.file.write(b'0')
            self.file.flush()
        self.file.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.file.close()
            self.file = None
            raise ReaderAlreadyRunning('The reader is already running in this installation.') from None
        return self

    def __exit__(self, *_):
        if self.file:
            self.file.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_UN)
            self.file.close()
            self.file = None


def request_stop(directory):
    try:
        with ReaderInstance(directory):
            return False
    except ReaderAlreadyRunning:
        (Path(directory) / '.stop-request').touch()
        return True


class StopMonitor(threading.Thread):
    def __init__(self, directory, reader):
        super().__init__(name='ReaderStopMonitor', daemon=True)
        self.path = Path(directory) / '.stop-request'
        self.reader = reader
        self.closed = threading.Event()

    def stop(self):
        self.closed.set()

    def run(self):
        while not self.closed.wait(0.25):
            if self.path.exists():
                self.path.unlink(missing_ok=True)
                self.reader.stop()
                return
