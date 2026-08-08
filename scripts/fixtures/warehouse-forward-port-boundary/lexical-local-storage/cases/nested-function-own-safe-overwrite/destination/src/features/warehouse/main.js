export function read() {
  function readNested() {
    let browser = globalThis
    browser = { localStorage: 'safe' }
    return browser.localStorage
  }
  return readNested()
}
