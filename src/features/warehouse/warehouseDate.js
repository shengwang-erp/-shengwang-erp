const tokyoFormatter = (options) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  ...options,
})

const parts = (date, options) => Object.fromEntries(
  tokyoFormatter(options)
    .formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]),
)

export const tokyoDate = (date = new Date()) => {
  const value = parts(date, { year: 'numeric', month: '2-digit', day: '2-digit' })
  return `${value.year}-${value.month}-${value.day}`
}

export const tokyoMonth = (date = new Date()) => tokyoDate(date).slice(0, 7)

export const formatTokyoDateTime = (date) => {
  if (!date) return '—'
  const parsed = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(parsed.getTime())) return '—'
  const value = parts(parsed, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}`
}
