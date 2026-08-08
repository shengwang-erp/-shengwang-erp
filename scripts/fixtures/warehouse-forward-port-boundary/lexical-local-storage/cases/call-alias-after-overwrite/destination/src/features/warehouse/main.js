export function read() {
  function mutate() {
    browser = window
  }
  let browser = globalThis
  const run = mutate
  browser = { localStorage: 'safe' }
  run()
  return browser.localStorage
}
