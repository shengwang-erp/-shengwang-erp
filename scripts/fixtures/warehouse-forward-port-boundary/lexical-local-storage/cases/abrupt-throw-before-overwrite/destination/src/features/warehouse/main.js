export function read(skip) {
  let browser
  if (skip) throw new Error('skip')
  browser = { localStorage: 'safe' }
  return browser.localStorage
}
