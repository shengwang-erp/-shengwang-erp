export function read() {
  function readNested() {
    let browser = globalThis
    return browser.localStorage
  }
  return readNested()
}
