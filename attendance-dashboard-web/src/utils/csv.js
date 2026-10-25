// Quote every field and keep spreadsheet programs from evaluating formulas.
export function encodeCSVCell(value) {
  const text = String(value ?? '')
  // Account for leading whitespace/control characters that readers may ignore.
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)
    ? `'${text}`
    : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function serializeCSV(rows) {
  return rows.map(row => row.map(encodeCSVCell).join(',')).join('\r\n')
}
