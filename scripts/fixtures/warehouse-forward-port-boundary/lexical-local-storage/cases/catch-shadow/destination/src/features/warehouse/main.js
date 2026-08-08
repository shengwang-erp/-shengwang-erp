export function read() {
  try {
    return 'ok'
  } catch (localStorage) {
    return localStorage.message
  }
}
