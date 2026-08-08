const storageKey = 'localStorage'

export const read = () => window[storageKey].getItem('warehouse')
