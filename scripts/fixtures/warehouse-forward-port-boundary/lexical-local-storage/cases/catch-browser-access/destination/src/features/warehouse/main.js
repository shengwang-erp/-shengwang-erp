export function read() {
  try {
    return 'ok'
  } catch (error) {
    return globalThis.localStorage.getItem(error.message)
  }
}
