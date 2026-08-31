"""
nfc_reader.py
-------------
Wraps the pyscard PC/SC API to poll the ACR122U NFC reader.

Design decisions
----------------
* Uses SCardGetStatusChange with a short timeout (500 ms) so the main loop
  stays responsive to shutdown signals.
* Returns the UID as an UPPERCASE hex string (e.g. "A1B2C3D4").
* On reader disconnection or PC/SC context errors, waits 5 seconds and retries
  automatically — the daemon should survive brief USB re-plugs.
* Exposes a simple generator interface: `for uid in reader.poll(): ...`

Platform notes
--------------
* On Linux, pyscard requires the pcscd daemon and libpcsclite:
      sudo apt install pcscd libpcsclite-dev
* On Windows, WinSCard is used automatically by pyscard.

MIFARE / ISO 14443 UID extraction
----------------------------------
The ACR122U returns the UID via the GET DATA APDU:
    FF CA 00 00 00
Response format: <uid_bytes> 90 00
We strip the trailing status bytes (90 00) to get the raw UID.
"""

import logging
import time
from typing import Generator, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Graceful import — pyscard is optional on machines without PC/SC installed
# (e.g. CI runners). The simulator in test_sim.py bypasses this module entirely.
try:
    from smartcard.Exceptions import CardConnectionException, NoCardException
    from smartcard.scard import (
        SCARD_E_NO_READERS_AVAILABLE,
        SCARD_S_SUCCESS,
        SCARD_STATE_PRESENT,
        SCardEstablishContext,
        SCardGetStatusChange,
        SCardListReaders,
        SCardReleaseContext,
        SCARD_SCOPE_USER,
    )
    from smartcard.System import readers as list_readers
    from smartcard.util import toHexString

    _PYSCARD_AVAILABLE = True
except Exception as _import_err:
    _PYSCARD_AVAILABLE = False
    logger.warning(
        "pyscard import error (%s). NFC hardware polling is disabled.", _import_err
    )

# APDU to retrieve the UID from a MIFARE / ISO 14443A tag
_GET_UID_APDU = [0xFF, 0xCA, 0x00, 0x00, 0x00]

# How long (seconds) to wait before retrying after a reader error
_RETRY_DELAY = 5

# Timeout per SCardGetStatusChange call (milliseconds)
_POLL_TIMEOUT_MS = 500


def _get_uid_from_card(connection) -> Optional[str]:
    """
    Send the GET DATA APDU and decode the UID.

    Returns:
        UID as an UPPERCASE hex string with no spaces (e.g. "A1B2C3D4"),
        or None if the APDU failed.
    """
    try:
        response, sw1, sw2 = connection.transmit(_GET_UID_APDU)
        if sw1 == 0x90 and sw2 == 0x00 and response:
            uid = "".join(f"{b:02X}" for b in response)
            return uid
        logger.warning("GET UID APDU returned SW1=%02X SW2=%02X", sw1, sw2)
    except Exception as exc:  # noqa: BLE001
        logger.error("APDU transmit error: %s", exc)
    return None


class NfcReader:
    """
    High-level NFC reader wrapper.

    Usage:
        reader = NfcReader()
        for uid in reader.poll():
            print(f"Tapped: {uid}")
    """

    def __init__(self, reader_index: int = 0) -> None:
        """
        Args:
            reader_index: Index into the list of PC/SC readers.
                          0 = first reader (the ACR122U if it's the only reader).
        """
        self.reader_index = reader_index
        self._running = False

    def stop(self) -> None:
        """Signal the polling loop to exit cleanly."""
        self._running = False

    def poll(self) -> Generator[str, None, None]:
        """
        Generator that yields a UID string each time a tag is placed on the reader.

        Runs until `stop()` is called or the process exits.
        Handles reader disconnections transparently with auto-retry.
        """
        if not _PYSCARD_AVAILABLE:
            logger.error("Cannot start NFC polling: pyscard is not available.")
            return

        self._running = True

        while self._running:
            available = list_readers()
            if not available:
                logger.warning("No PC/SC readers found. Retrying in %ds…", _RETRY_DELAY)
                time.sleep(_RETRY_DELAY)
                continue

            reader = available[self.reader_index] if self.reader_index < len(available) else available[0]
            logger.info("Using NFC reader: %s", reader)

            try:
                yield from self._poll_reader(reader)
            except Exception as exc:  # noqa: BLE001
                logger.error("Reader error (%s). Reconnecting in %ds…", exc, _RETRY_DELAY)
                time.sleep(_RETRY_DELAY)

    def _poll_reader(self, reader) -> Generator[str, None, None]:
        """
        Inner loop for a single reader session.

        Uses a blocking connection approach: connect → read UID → disconnect,
        repeated on each card-present event. SCardGetStatusChange is used to
        detect card presence without busy-waiting.
        """
        last_uid: Optional[str] = None

        while self._running:
            try:
                connection = reader.createConnection()
                connection.connect()

                uid = _get_uid_from_card(connection)
                connection.disconnect()

                if uid and uid != last_uid:
                    last_uid = uid
                    logger.info("Tag detected: %s", uid)
                    yield uid
                elif not uid:
                    last_uid = None

                # Brief pause to avoid hammering the PC/SC daemon while a card is held
                time.sleep(0.3)

            except (CardConnectionException, NoCardException):
                # Card was removed or not yet presented — this is normal
                last_uid = None
                time.sleep(0.3)
            except Exception as exc:  # noqa: BLE001
                logger.debug("Connect attempt failed (%s) — card likely absent.", exc)
                last_uid = None
                time.sleep(0.3)
