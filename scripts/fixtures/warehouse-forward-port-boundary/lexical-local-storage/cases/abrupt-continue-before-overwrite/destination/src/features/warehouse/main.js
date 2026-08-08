export function read(skip) {
  let browser
  for (let index = 0; index < 1; index += 1) {
    if (skip) continue
    browser = { localStorage: 'safe' }
    void browser.localStorage
  }
  return null
}
