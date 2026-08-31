"""
scan_uid.py
-----------
Quick utility to read and print raw NFC tag UIDs from the ACR122U.
Use this to identify your clock-out tag UID before entering it in config.json.

Usage:
    python scan_uid.py

Tap a tag → UID is printed → Ctrl+C to quit.
"""

import sys
import time

try:
    from smartcard.System import readers as list_readers
    from smartcard.Exceptions import CardConnectionException, NoCardException
except ImportError:
    print("ERROR: pyscard is not installed. Run: pip install pyscard")
    sys.exit(1)

_GET_UID_APDU = [0xFF, 0xCA, 0x00, 0x00, 0x00]


def main():
    print("=" * 50)
    print("  NFC UID Scanner — tap a tag to read its UID")
    print("  Ctrl+C to quit")
    print("=" * 50)

    last_uid = None

    while True:
        available = list_readers()
        if not available:
            print("No PC/SC readers found. Plug in the ACR122U and retry…")
            time.sleep(3)
            continue

        reader = available[0]

        try:
            conn = reader.createConnection()
            conn.connect()
            response, sw1, sw2 = conn.transmit(_GET_UID_APDU)
            conn.disconnect()

            if sw1 == 0x90 and sw2 == 0x00 and response:
                uid = "".join(f"{b:02X}" for b in response)
                if uid != last_uid:
                    print(f"  UID detected: {uid}")
                    last_uid = uid
            time.sleep(0.3)

        except (CardConnectionException, NoCardException):
            last_uid = None
            time.sleep(0.3)
        except KeyboardInterrupt:
            print("\nExiting.")
            break


if __name__ == "__main__":
    main()
