export function read() {
  let browser = globalThis
  function mutate() {
    browser = window
  }
  mutate()
  browser = { localStorage: 'safe' }
  return browser.localStorage
}
