const key = 'localStorage'

function innerRead() {
  const key = 'other'
  return globalThis[key]
}

export const read = () => globalThis[key]
export const inner = innerRead
