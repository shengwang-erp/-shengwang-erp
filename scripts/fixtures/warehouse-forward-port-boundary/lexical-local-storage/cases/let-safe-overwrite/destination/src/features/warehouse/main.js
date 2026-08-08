export function read() {
  let browser = globalThis
  browser = { localStorage: 'safe' }
  return browser.localStorage
}
