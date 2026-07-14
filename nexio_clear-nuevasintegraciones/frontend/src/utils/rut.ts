/** Format a Chilean RUT as XX.XXX.XXX-Y while typing. */
export function formatRut(raw: string): string {
  const clean = raw.replace(/[^0-9kK]/g, '').toUpperCase()
  if (clean.length < 2) return clean
  const body = clean.slice(0, -1)
  const dv   = clean.slice(-1)
  const dotted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${dotted}-${dv}`
}

/** Use in onChange: strips, caps to 9 chars, formats. */
export function rutOnChange(raw: string): string {
  const clean = raw.replace(/[^0-9kK]/g, '').toUpperCase().slice(0, 9)
  if (clean.length < 2) return clean
  const body = clean.slice(0, -1)
  const dv   = clean.slice(-1)
  const dotted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${dotted}-${dv}`
}
