const storageKey = 'localStorage'

export const read = () => globalThis[storageKey].getItem('warehouse')
