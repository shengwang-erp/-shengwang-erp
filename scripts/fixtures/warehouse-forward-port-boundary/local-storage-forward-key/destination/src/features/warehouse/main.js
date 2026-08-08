export function read() {
  return globalThis[key].getItem('warehouse')
}

const key = 'localStorage'
