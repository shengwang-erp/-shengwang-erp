const browser = { safe: true }

export function read() {
  const browser = self
  return browser.localStorage.getItem('warehouse')
}
