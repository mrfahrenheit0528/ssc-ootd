"""ACR122U automatic detection buzzer control; never writes to a card.

ACS ACR122U API section 6.7 and Appendix A:
https://downloads.acs.com.hk/drivers/en/API-ACR122U-2.03.pdf
"""
import logging

try:
    from smartcard import scard
except Exception:
    scard = None

logger = logging.getLogger(__name__)


def buzzer_command(enabled):
    return [0xFF, 0x00, 0x52, 0xFF if enabled else 0x00, 0x00]


def supports_buzzer_control(reader):
    return 'ACR122' in str(reader).upper()


def set_detection_buzzer(reader, enabled=False, api=scard):
    """Configure the reader without a card present. Release without resetting it."""
    if not supports_buzzer_control(reader) or api is None:
        logger.warning('Automatic buzzer control is unavailable for %s.', reader)
        return False
    context = handle = None
    try:
        status, created_context = api.SCardEstablishContext(api.SCARD_SCOPE_USER)
        if status != api.SCARD_S_SUCCESS:
            raise RuntimeError(api.SCardGetErrorMessage(status))
        context = created_context
        # No T=0/T=1 negotiation: a direct reader handle must work without a card.
        status, connected_handle, _ = api.SCardConnect(context, str(reader), api.SCARD_SHARE_DIRECT, api.SCARD_PROTOCOL_UNDEFINED)
        if status != api.SCARD_S_SUCCESS:
            raise RuntimeError(api.SCardGetErrorMessage(status))
        handle = connected_handle
        status, response = api.SCardControl(handle, api.SCARD_CTL_CODE(3500), buzzer_command(enabled))
        if status != api.SCARD_S_SUCCESS:
            raise RuntimeError(api.SCardGetErrorMessage(status))
        if list(response)[-2:] != [0x90, 0x00]:
            raise RuntimeError('Reader rejected buzzer command: '+bytes(response).hex(' '))
        logger.info('Automatic card-detection buzzer %s for %s.', 'enabled' if enabled else 'disabled', reader)
        return True
    except Exception as exc:
        logger.warning('Could not configure the hardware buzzer for %s: %s. Attendance remains enabled.', reader, exc)
        return False
    finally:
        if handle is not None:
            try:
                api.SCardDisconnect(handle, api.SCARD_LEAVE_CARD)
            except Exception:
                logger.debug('Could not release buzzer control handle.', exc_info=True)
        if context is not None:
            try:
                api.SCardReleaseContext(context)
            except Exception:
                logger.debug('Could not release buzzer control context.', exc_info=True)


def set_buzzer_with_card(connection, enabled=False):
    """Fallback for drivers that permit APDUs but block direct escape commands."""
    try:
        _, sw1, sw2 = connection.transmit(buzzer_command(enabled))
        if (sw1, sw2) != (0x90, 0x00):
            raise RuntimeError(f'Buzzer command returned {sw1:02X} {sw2:02X}')
        logger.info('Automatic card-detection buzzer %s via the card connection.', 'enabled' if enabled else 'disabled')
        return True
    except Exception as exc:
        logger.warning('Card-connection buzzer control failed: %s. The reader may still beep; UID reading will continue.', exc)
        return False


def main():
    import argparse
    from smartcard.System import readers
    parser = argparse.ArgumentParser(description='Set the ACR122U detection beep without recording attendance.')
    parser.add_argument('--buzzer', choices=['off', 'on'], required=True)
    parser.add_argument('--reader-index', type=int, default=0)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
    available = readers()
    if not 0 <= args.reader_index < len(available):
        logger.error('Selected NFC reader is not connected.')
        return 1
    return 0 if set_detection_buzzer(available[args.reader_index], enabled=args.buzzer == 'on') else 1


if __name__ == '__main__':
    raise SystemExit(main())
