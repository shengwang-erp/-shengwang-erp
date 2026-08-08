export function read() {
  return g[key].getItem('warehouse')
}

const g = globalThis
const key = 'localStorage'
