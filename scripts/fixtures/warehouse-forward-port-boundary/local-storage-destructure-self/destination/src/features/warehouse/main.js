const { localStorage: storage } = self

export const read = () => storage.getItem('warehouse')
