export function read() {
  let browser = globalThis
  browser = { localStorage: 'safe' }
  function mutate() {
    browser = window
  }
  return browser.localStorage
}
