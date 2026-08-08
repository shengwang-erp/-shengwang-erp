const localStorage = globalThis.localStorage

export const read = () => localStorage.getItem('warehouse')
