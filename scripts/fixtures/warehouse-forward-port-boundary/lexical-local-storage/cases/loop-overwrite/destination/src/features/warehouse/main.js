export function read(values) {
  let browser
  for (const value of values) {
    browser = { value, localStorage: 'safe' }
  }
  return browser.localStorage
}
