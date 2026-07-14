import { format, isToday, isSameDay } from 'date-fns'
import { es } from 'date-fns/locale'

// For UTC-stored datetimes (created_at, activity timestamps)
export function parseDate(iso: string | null | undefined): Date {
  if (!iso) return new Date()
  return new Date(/Z$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + 'Z')
}

// For calendar event start_time/end_time stored as naive local time (user-entered)
export function parseLocalDate(iso: string | null | undefined): Date {
  if (!iso) return new Date()
  return new Date(iso)
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return format(parseDate(iso), "d MMM yyyy · HH:mm", { locale: es })
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return format(parseDate(iso), "d MMM yyyy", { locale: es })
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return format(parseDate(iso), "HH:mm")
}

export function fmtShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = parseDate(iso)
  if (isToday(d)) return format(d, 'HH:mm')
  return format(d, "d MMM", { locale: es })
}

export { isToday, isSameDay }
