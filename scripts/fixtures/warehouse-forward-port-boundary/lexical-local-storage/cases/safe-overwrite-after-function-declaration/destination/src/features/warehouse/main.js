export function read() {
  let browser = globalThis
  function helper() {
    return null
  }
  browser = { helper, localStorage: 'safe' }
  return browser.localStorage
}
