import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodeCSVCell, serializeCSV } from './csv.js'

test('neutralizes spreadsheet formulas, including whitespace prefixes', () => {
  for (const value of ['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1)', '  =1', '\t=1', '\r=1', '\n=1', '\u0000=1']) {
    assert.equal(encodeCSVCell(value), `"'${value}"`)
  }
})

test('preserves ordinary text, quotes, commas, newlines and empty values', () => {
  assert.equal(encodeCSVCell('Ana "A", Cruz'), '"Ana ""A"", Cruz"')
  assert.equal(encodeCSVCell('line one\nline two'), '"line one\nline two"')
  assert.equal(encodeCSVCell('AB0012'), '"AB0012"')
  assert.equal(encodeCSVCell(null), '""')
  assert.equal(encodeCSVCell(0), '"0"')
})

test('keeps formula payloads in quoted text cells in a complete CSV', () => {
  assert.equal(serializeCSV([
    ['Name', 'Position'],
    ['=HYPERLINK("https://example.com")', 'Member, SSC'],
  ]), '"Name","Position"\r\n"\'=HYPERLINK(""https://example.com"")","Member, SSC"')
})
