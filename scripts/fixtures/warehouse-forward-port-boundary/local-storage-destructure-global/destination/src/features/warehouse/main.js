const { localStorage: storage } = globalThis

export const read = () => storage.getItem('warehouse')
