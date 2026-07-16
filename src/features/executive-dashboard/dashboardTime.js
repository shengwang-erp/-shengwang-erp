const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/u
const DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u

export function normalizeMonth(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  const match = MONTH_PATTERN.exec(text)
  if (!match) return ''
  const year = Number(match[1])
  return year >= 1900 && year <= 2100 ? text : ''
}

export function buildMonthWindow(endMonth, length = 12) {
  const normalized = normalizeMonth(endMonth)
  if (!normalized || !Number.isSafeInteger(length) || length < 1 || length > 120) return []
  const [year, month] = normalized.split('-').map(Number)
  const endIndex = year * 12 + month - 1
  if (endIndex - length + 1 < 1900 * 12) return []
  return Array.from({ length }, (_, offset) => {
    const index = endIndex - length + 1 + offset
    const itemYear = Math.floor(index / 12)
    const itemMonth = index % 12 + 1
    return `${String(itemYear).padStart(4, '0')}-${String(itemMonth).padStart(2, '0')}`
  })
}

export function monthOfDate(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  const match = DATE_PATTERN.exec(text)
  if (!match) return ''
  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (year < 1900 || year > 2100) return ''
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day ? text.slice(0, 7) : ''
}

export function isDateInMonth(value, month) {
  return monthOfDate(value) === normalizeMonth(month) && normalizeMonth(month) !== ''
}
