export function read() {
  let browser
  try {
    browser = { localStorage: 'safe' }
  } catch {
    return null
  }
  return browser.localStorage
}
