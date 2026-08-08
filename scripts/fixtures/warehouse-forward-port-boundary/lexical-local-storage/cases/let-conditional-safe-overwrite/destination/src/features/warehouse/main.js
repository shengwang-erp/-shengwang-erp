export function read(useSafeObject) {
  let browser = globalThis
  if (useSafeObject) browser = { localStorage: 'safe' }
  return browser.localStorage
}
