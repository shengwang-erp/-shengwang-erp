const safeBrowser = { localStorage: 'safe' }

export function read(browser = safeBrowser) {
  var safeBrowser = globalThis
  return browser.localStorage
}
