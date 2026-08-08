const { localStorage: storage } = window

export const read = () => storage.getItem('warehouse')
