const outerBrowser = globalThis

export function read(browser = outerBrowser) {
  var outerBrowser = { localStorage: 'safe' }
  return browser.localStorage
}
