export function read() {
  let browser
  try {
    return null
  } finally {
    browser = { localStorage: 'safe' }
    void browser.localStorage
  }
}
