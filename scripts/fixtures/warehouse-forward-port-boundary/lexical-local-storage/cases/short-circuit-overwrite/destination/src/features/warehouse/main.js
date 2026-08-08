export function read(enabled) {
  let browser
  enabled && (browser = { localStorage: 'safe' })
  return browser.localStorage
}
