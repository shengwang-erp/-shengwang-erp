export function read(callback) {
  function mutate() {
    browser = window
  }
  let browser = globalThis
  browser = { localStorage: 'safe' }
  callback(mutate)
  return browser.localStorage
}
