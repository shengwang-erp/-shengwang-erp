export function read(skip) {
  let browser
  guarded: {
    if (skip) break guarded
    browser = { localStorage: 'safe' }
    return browser.localStorage
  }
  return null
}
