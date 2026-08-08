export function read(mode) {
  let browser
  switch (mode) {
    case 'safe':
      browser = { localStorage: 'safe' }
      break
    default:
      browser = { localStorage: 'also-safe' }
  }
  return browser.localStorage
}
