export function read(callbacks) {
  function mutate() {
    browser = window
  }
  let browser = globalThis
  browser = { localStorage: 'safe' }
  callbacks.forEach(mutate)
  return browser.localStorage
}
