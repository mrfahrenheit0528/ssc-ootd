"""Buzzer commands and reconnect behavior without NFC hardware."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

import nfc_reader
from reader_buzzer import buzzer_command, set_detection_buzzer, set_buzzer_with_card


class BuzzerTests(unittest.TestCase):
    def setUp(self):
        self.api = SimpleNamespace(
            SCARD_SCOPE_USER=0, SCARD_S_SUCCESS=0, SCARD_SHARE_DIRECT=3,
            SCARD_PROTOCOL_UNDEFINED=0, SCARD_LEAVE_CARD=0,
            SCardEstablishContext=Mock(return_value=(0, 99)),
            SCardConnect=Mock(return_value=(0, 123, 0)),
            SCardControl=Mock(return_value=(0, [0x90, 0x00])),
            SCardDisconnect=Mock(), SCardReleaseContext=Mock(),
            SCARD_CTL_CODE=Mock(return_value=0x3136B0),
            SCardGetErrorMessage=Mock(return_value='PC/SC test error'),
        )

    def test_mute_command_uses_a_direct_handle_without_card_protocol_negotiation(self):
        self.assertTrue(set_detection_buzzer('ACS ACR122 0', api=self.api))
        self.api.SCardConnect.assert_called_once_with(99, 'ACS ACR122 0', 3, 0)
        self.api.SCARD_CTL_CODE.assert_called_once_with(3500)
        self.api.SCardControl.assert_called_once_with(123, 0x3136B0, [0xFF, 0x00, 0x52, 0x00, 0x00])
        self.api.SCardDisconnect.assert_called_once_with(123, 0)
        self.api.SCardReleaseContext.assert_called_once_with(99)

    def test_explicit_reenable_uses_the_documented_detection_setting(self):
        self.assertTrue(set_detection_buzzer('ACS ACR122U PICC Interface 0', enabled=True, api=self.api))
        self.api.SCardControl.assert_called_once_with(123, 0x3136B0, [0xFF, 0x00, 0x52, 0xFF, 0x00])

    def test_context_failure_does_not_attempt_card_access_or_release_an_invalid_handle(self):
        self.api.SCardEstablishContext.return_value = (1, None)
        with self.assertLogs('reader_buzzer', level='WARNING'):
            self.assertFalse(set_detection_buzzer('ACS ACR122 0', api=self.api))
        self.api.SCardConnect.assert_not_called()
        self.api.SCardReleaseContext.assert_not_called()

    def test_busy_reader_releases_only_its_context_and_does_not_interrupt_card_reading(self):
        self.api.SCardConnect.return_value = (1, None, 0)
        with self.assertLogs('reader_buzzer', level='WARNING'):
            self.assertFalse(set_detection_buzzer('ACS ACR122 0', api=self.api))
        self.api.SCardControl.assert_not_called()
        self.api.SCardDisconnect.assert_not_called()
        self.api.SCardReleaseContext.assert_called_once_with(99)

    def test_transport_error_and_rejected_command_never_report_the_buzzer_as_muted(self):
        for response in [(1, []), (0, [0x63, 0x00]), (0, [])]:
            with self.subTest(response=response):
                self.api.SCardControl.return_value = response
                self.api.SCardDisconnect.reset_mock()
                self.api.SCardReleaseContext.reset_mock()
                with self.assertLogs('reader_buzzer', level='WARNING'):
                    self.assertFalse(set_detection_buzzer('ACS ACR122 0', api=self.api))
                self.api.SCardDisconnect.assert_called_once_with(123, 0)
                self.api.SCardReleaseContext.assert_called_once_with(99)

    def test_other_reader_models_are_not_sent_acs_vendor_commands(self):
        with self.assertLogs('reader_buzzer', level='WARNING'):
            self.assertFalse(set_detection_buzzer('Other smartcard reader', api=self.api))
            self.assertFalse(set_detection_buzzer('ACS ACR122 0', api=None))
        self.api.SCardEstablishContext.assert_not_called()

    def test_card_connection_fallback_checks_the_reader_acknowledgment(self):
        connection = Mock()
        connection.transmit.return_value = ([], 0x90, 0x00)
        self.assertTrue(set_buzzer_with_card(connection))
        connection.transmit.assert_called_once_with(buzzer_command(False))
        connection.transmit.return_value = ([], 0x63, 0x00)
        with self.assertLogs('reader_buzzer', level='WARNING'):
            self.assertFalse(set_buzzer_with_card(connection))

    def test_fallback_failure_does_not_block_uid_reading(self):
        reader = nfc_reader.NfcReader()
        reader._running = True
        connection = Mock()
        connection.transmit.side_effect = [([], 0x63, 0x00), ([0xAA, 0xBB, 0xCC, 0xDD], 0x90, 0x00)]
        hardware = Mock()
        hardware.createConnection.return_value = connection
        polling = reader._poll_reader(hardware, fallback_buzzer=True)
        with self.assertLogs('reader_buzzer', level='WARNING'):
            self.assertEqual(next(polling), 'AABBCCDD')
        polling.close()
        connection.transmit.assert_has_calls([call(buzzer_command(False)), call([0xFF, 0xCA, 0, 0, 0])])
        connection.disconnect.assert_called_once()

    def test_reader_disconnect_is_propagated_to_reconnect_instead_of_treated_as_card_absence(self):
        class ReaderDisconnected(Exception):
            pass
        class NoCard(Exception):
            pass
        reader = nfc_reader.NfcReader()
        reader._running = True
        hardware = Mock()
        hardware.createConnection.return_value.connect.side_effect = ReaderDisconnected('Unplugged')
        with patch.object(nfc_reader, 'CardConnectionException', ReaderDisconnected, create=True), patch.object(nfc_reader, 'NoCardException', NoCard, create=True):
            with self.assertRaises(ReaderDisconnected):
                next(reader._poll_reader(hardware))

    def test_reconnected_reader_gets_the_mute_setting_again_before_cards_are_processed(self):
        reader = nfc_reader.NfcReader()
        hardware = 'ACS ACR122 0'
        attempts = []
        def cards(device, fallback_buzzer=False):
            attempts.append(device)
            if len(attempts) == 1:
                raise RuntimeError('Reader unplugged')
            yield 'AABBCCDD'
            reader.stop()
        with patch.object(nfc_reader, '_PYSCARD_AVAILABLE', True), \
             patch.object(nfc_reader, 'list_readers', side_effect=[[hardware], [], [hardware]], create=True), \
             patch('nfc_reader.set_detection_buzzer', return_value=True) as mute, \
             patch.object(reader, '_poll_reader', side_effect=cards), patch('nfc_reader.time.sleep'), self.assertLogs('nfc_reader'):
            self.assertEqual(list(reader.poll()), ['AABBCCDD'])
        self.assertEqual(mute.call_args_list, [call(hardware, enabled=False), call(hardware, enabled=False)])

    def test_service_disruption_retries_and_direct_control_failure_enables_safe_card_fallback(self):
        reader = nfc_reader.NfcReader(buzzer_enabled=True)
        def cards(device, fallback_buzzer=False):
            self.assertTrue(fallback_buzzer)
            reader.stop()
            yield 'AABBCCDD'
        with patch.object(nfc_reader, '_PYSCARD_AVAILABLE', True), \
             patch.object(nfc_reader, 'list_readers', side_effect=[OSError('PC/SC unavailable'), ['ACS ACR122 0']], create=True), \
             patch('nfc_reader.set_detection_buzzer', return_value=False) as mute, \
             patch.object(reader, '_poll_reader', side_effect=cards), patch('nfc_reader.time.sleep'), self.assertLogs('nfc_reader'):
            self.assertEqual(list(reader.poll()), ['AABBCCDD'])
        mute.assert_called_once_with('ACS ACR122 0', enabled=True)


if __name__ == '__main__':
    unittest.main()
