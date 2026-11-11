// card_uid remains the stable legacy profile key used by historical logs and
// assignments. nfc_uid is the real optional card; never display generated keys
// as if they were scanned NFC UIDs. Older snapshots remain readable.
export function nfcUid(officer, fallback) {
  if (officer?.nfc_uid !== undefined) return officer.nfc_uid || null
  const value = officer?.card_uid ?? fallback
  return value && !/^OFF[A-F0-9]{32}$/.test(value) ? value : null
}
