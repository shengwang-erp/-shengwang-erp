const storageKey = 'localStorage'

export const read = () => self[storageKey].getItem('warehouse')
