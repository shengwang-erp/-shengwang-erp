export function read() {
  function mutate() {
    browser = window
  }
  let browser = globalThis
  browser = { localStorage: 'safe' }
  return (mutate(), browser.localStorage)
}
