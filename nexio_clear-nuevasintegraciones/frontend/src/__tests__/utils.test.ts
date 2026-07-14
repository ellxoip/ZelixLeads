/**
 * Tests for frontend utility functions:
 * - rut formatting (formatRut, rutOnChange)
 * - date helpers (parseDate, fmtDate, fmtDateTime, fmtTime, fmtShort)
 */
import { describe, it, expect } from 'vitest'
import { formatRut, rutOnChange } from '../utils/rut'
import { parseDate, parseLocalDate, fmtDate, fmtDateTime, fmtTime, fmtShort } from '../utils/dates'

// ── RUT formatting ─────────────────────────────────────────────────────────────

describe('formatRut', () => {
  it('formats a 9-char RUT correctly', () => {
    expect(formatRut('123456789')).toBe('12.345.678-9')
  })

  it('formats a RUT with K check digit', () => {
    expect(formatRut('1234567K')).toBe('1.234.567-K')
  })

  it('returns raw input if only 1 char', () => {
    expect(formatRut('1')).toBe('1')
  })

  it('strips non-numeric characters except K', () => {
    expect(formatRut('12.345.678-9')).toBe('12.345.678-9')
  })

  it('handles empty string', () => {
    expect(formatRut('')).toBe('')
  })

  it('uppercases k to K', () => {
    const result = formatRut('1234567k')
    expect(result).toContain('K')
  })
})

describe('rutOnChange', () => {
  it('formats while typing — short input', () => {
    expect(rutOnChange('123')).toBe('12-3')
  })

  it('caps at 9 significant chars (dots and dash excluded from cap)', () => {
    const result = rutOnChange('123456789012345')
    // Should cap at 9 clean chars → 12.345.678-9
    expect(result).toBe('12.345.678-9')
  })

  it('handles pasted RUT with dots and dash', () => {
    const result = rutOnChange('12.345.678-9')
    expect(result).toBe('12.345.678-9')
  })

  it('returns empty string for empty input', () => {
    expect(rutOnChange('')).toBe('')
  })
})

// ── Date helpers ───────────────────────────────────────────────────────────────

describe('parseDate', () => {
  it('parses an ISO UTC string correctly', () => {
    const d = parseDate('2024-01-15T14:30:00Z')
    expect(d instanceof Date).toBe(true)
    expect(isNaN(d.getTime())).toBe(false)
  })

  it('treats plain date strings as UTC', () => {
    const d = parseDate('2024-01-15T14:30:00')
    expect(d instanceof Date).toBe(true)
    expect(isNaN(d.getTime())).toBe(false)
  })

  it('returns a Date for null input', () => {
    const d = parseDate(null)
    expect(d instanceof Date).toBe(true)
  })

  it('returns a Date for undefined input', () => {
    const d = parseDate(undefined)
    expect(d instanceof Date).toBe(true)
  })
})

describe('parseLocalDate', () => {
  it('parses a datetime string', () => {
    const d = parseLocalDate('2024-03-20T09:00:00')
    expect(d instanceof Date).toBe(true)
    expect(isNaN(d.getTime())).toBe(false)
  })
})

describe('fmtDate', () => {
  it('returns formatted Spanish date string', () => {
    const result = fmtDate('2024-06-01T00:00:00Z')
    expect(typeof result).toBe('string')
    expect(result).not.toBe('—')
    // Should include month abbreviation
    expect(result).toMatch(/\d+ \w+ \d{4}/)
  })

  it('returns "—" for null', () => {
    expect(fmtDate(null)).toBe('—')
  })

  it('returns "—" for undefined', () => {
    expect(fmtDate(undefined)).toBe('—')
  })
})

describe('fmtDateTime', () => {
  it('returns formatted datetime with dot separator', () => {
    const result = fmtDateTime('2024-06-01T10:30:00Z')
    expect(typeof result).toBe('string')
    expect(result).not.toBe('—')
    expect(result).toContain('·')
  })

  it('returns "—" for null', () => {
    expect(fmtDateTime(null)).toBe('—')
  })
})

describe('fmtTime', () => {
  it('returns HH:MM format', () => {
    const result = fmtTime('2024-06-01T10:30:00Z')
    expect(typeof result).toBe('string')
    expect(result).toMatch(/^\d{2}:\d{2}$/)
  })

  it('returns "—" for null', () => {
    expect(fmtTime(null)).toBe('—')
  })
})

describe('fmtShort', () => {
  it('returns "—" for null', () => {
    expect(fmtShort(null)).toBe('—')
  })

  it('returns a string for a valid date', () => {
    const result = fmtShort('2024-06-01T10:30:00Z')
    expect(typeof result).toBe('string')
    expect(result).not.toBe('—')
  })
})
