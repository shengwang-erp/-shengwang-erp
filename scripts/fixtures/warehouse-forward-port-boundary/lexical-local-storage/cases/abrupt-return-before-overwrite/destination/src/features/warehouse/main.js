export function read(skip) {
  let browser
  if (skip) return null
  browser = { localStorage: 'safe' }
  return browser.localStorage
}
