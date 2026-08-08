export function read() {
  let browser = globalThis
  void browser.localStorage
  browser = { localStorage: 'safe' }
  return browser
}
