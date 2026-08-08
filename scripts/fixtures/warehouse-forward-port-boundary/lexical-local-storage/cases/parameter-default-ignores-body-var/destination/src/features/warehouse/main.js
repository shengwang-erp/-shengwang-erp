export function read(browser = globalThis) {
  var globalThis = { localStorage: 'safe' }
  return browser.localStorage
}
